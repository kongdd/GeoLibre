package org.geolibre.fieldmedia

import android.app.Activity
import android.content.ClipData
import android.content.ContentValues
import android.content.Intent
import android.graphics.Bitmap
import android.net.Uri
import android.os.Build
import android.os.Environment
import android.provider.MediaStore
import android.util.Base64
import android.util.Size
import android.webkit.WebView
import androidx.activity.result.ActivityResult
import androidx.exifinterface.media.ExifInterface
import app.tauri.annotation.ActivityCallback
import app.tauri.annotation.Command
import app.tauri.annotation.InvokeArg
import app.tauri.annotation.TauriPlugin
import app.tauri.plugin.Invoke
import app.tauri.plugin.JSArray
import app.tauri.plugin.JSObject
import app.tauri.plugin.Plugin
import java.io.ByteArrayOutputStream
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

@InvokeArg
class PickPhotosArgs {
    var max: Int = 1
}

@InvokeArg
class ReadPhotoArgs {
    lateinit var uri: String
    var quality: String = "original"
}

private data class PendingPhoto(val uri: Uri, val name: String, val mimeType: String)
private data class PhotoInfo(val name: String, val mimeType: String)

@TauriPlugin
class FieldMediaPlugin(private val activity: Activity) : Plugin(activity) {
    private var pendingCapture: PendingPhoto? = null
    private var pickLimit = 1

    override fun load(webView: WebView) {
        super.load(webView)
    }

    @Command
    fun capturePhoto(invoke: Invoke) {
        try {
            val photo = createPhoto("IMG_${timestamp()}.jpg", "image/jpeg")
            pendingCapture = photo
            val intent = Intent(MediaStore.ACTION_IMAGE_CAPTURE).apply {
                putExtra(MediaStore.EXTRA_OUTPUT, photo.uri)
                clipData = ClipData.newRawUri("GeoLibre photo", photo.uri)
                addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_GRANT_WRITE_URI_PERMISSION)
            }
            if (intent.resolveActivity(activity.packageManager) == null) {
                activity.contentResolver.delete(photo.uri, null, null)
                pendingCapture = null
                invoke.reject("No system camera is available")
                return
            }
            startActivityForResult(invoke, intent, "capturePhotoResult")
        } catch (error: Exception) {
            invoke.reject(error.message ?: "Could not open the system camera")
        }
    }

    @ActivityCallback
    fun capturePhotoResult(invoke: Invoke, result: ActivityResult) {
        val pending = pendingCapture
        pendingCapture = null
        val response = JSObject()
        if (pending == null) {
            response.put("photo", null)
            invoke.resolve(response)
            return
        }
        // Some OEM camera apps write EXTRA_OUTPUT successfully but still return
        // RESULT_CANCELED after the user confirms. The MediaStore bytes are the
        // reliable result; deleting solely from resultCode loses the photo.
        if (result.resultCode != Activity.RESULT_OK && !hasPhotoData(pending.uri)) {
            activity.contentResolver.delete(pending.uri, null, null)
            response.put("photo", null)
            invoke.resolve(response)
            return
        }
        try {
            publish(pending.uri)
            response.put("photo", photoObject(pending))
            invoke.resolve(response)
        } catch (error: Exception) {
            activity.contentResolver.delete(pending.uri, null, null)
            invoke.reject(error.message ?: "Could not save the photo")
        }
    }

    @Command
    fun pickPhotos(invoke: Invoke) {
        try {
            val args = invoke.parseArgs(PickPhotosArgs::class.java)
            pickLimit = args.max.coerceIn(1, 10)
            // ACTION_OPEN_DOCUMENT is more reliable than the backported Android
            // Photo Picker on some OEM systems and still grants direct URI access.
            val intent = Intent(Intent.ACTION_OPEN_DOCUMENT).apply {
                addCategory(Intent.CATEGORY_OPENABLE)
                type = "image/*"
                putExtra(Intent.EXTRA_ALLOW_MULTIPLE, pickLimit > 1)
            }
            startActivityForResult(invoke, intent, "pickPhotosResult")
        } catch (error: Exception) {
            invoke.reject(error.message ?: "Could not open the system image picker")
        }
    }

    @ActivityCallback
    fun pickPhotosResult(invoke: Invoke, result: ActivityResult) {
        val response = JSObject()
        if (result.resultCode != Activity.RESULT_OK || result.data == null) {
            response.put("photos", JSArray())
            invoke.resolve(response)
            return
        }
        val sources = mutableListOf<Uri>()
        result.data?.data?.let(sources::add)
        result.data?.clipData?.let { clips ->
            for (index in 0 until clips.itemCount) sources.add(clips.getItemAt(index).uri)
        }
        Thread {
            val created = mutableListOf<Uri>()
            try {
                val photos = JSArray()
                sources.distinct().take(pickLimit).forEachIndexed { index, source ->
                    val info = sourceInfo(source)
                    val name = "${timestamp()}_${index + 1}_${safeName(info.name, info.mimeType)}"
                    val target = createPhoto(name, info.mimeType)
                    created.add(target.uri)
                    activity.contentResolver.openInputStream(source).use { input ->
                        requireNotNull(input) { "Could not read selected photo" }
                        activity.contentResolver.openOutputStream(target.uri, "w").use { output ->
                            requireNotNull(output) { "Could not create gallery photo" }
                            input.copyTo(output)
                        }
                    }
                    publish(target.uri)
                    photos.put(photoObject(target))
                }
                response.put("photos", photos)
                invoke.resolve(response)
            } catch (error: Exception) {
                created.forEach { activity.contentResolver.delete(it, null, null) }
                invoke.reject(error.message ?: "Could not import selected photos")
            }
        }.start()
    }

    @Command
    fun openPhoto(invoke: Invoke) {
        try {
            val uri = Uri.parse(invoke.parseArgs(ReadPhotoArgs::class.java).uri)
            requireOwnedPhoto(uri)
            val intent = Intent(Intent.ACTION_VIEW).apply {
                setDataAndType(uri, activity.contentResolver.getType(uri) ?: "image/*")
                clipData = ClipData.newRawUri("GeoLibre photo", uri)
                addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
            }
            require(intent.resolveActivity(activity.packageManager) != null) {
                "No system photo viewer is available"
            }
            activity.startActivity(intent)
            invoke.resolve()
        } catch (error: Exception) {
            invoke.reject(error.message ?: "Could not open photo")
        }
    }

    @Command
    fun readPhoto(invoke: Invoke) {
        try {
            val args = invoke.parseArgs(ReadPhotoArgs::class.java)
            val uri = Uri.parse(args.uri)
            requireOwnedPhoto(uri)
            val sourceMime = activity.contentResolver.getType(uri) ?: "image/jpeg"
            val portableOriginal = sourceMime in setOf(
                "image/jpeg", "image/jpg", "image/png", "image/webp", "image/gif"
            )
            val (mimeType, bytes) = if (args.quality == "original" && portableOriginal) {
                sourceMime to requireNotNull(activity.contentResolver.openInputStream(uri)) {
                    "Photo is unavailable"
                }.use { it.readBytes() }
            } else {
                val bitmap = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                    activity.contentResolver.loadThumbnail(uri, Size(2560, 2560), null)
                } else {
                    error("Android 10 or newer is required")
                }
                "image/jpeg" to ByteArrayOutputStream().use { output ->
                    bitmap.compress(Bitmap.CompressFormat.JPEG, 92, output)
                    bitmap.recycle()
                    output.toByteArray()
                }
            }
            val response = JSObject()
            response.put("dataUrl", "data:$mimeType;base64,${Base64.encodeToString(bytes, Base64.NO_WRAP)}")
            invoke.resolve(response)
        } catch (error: Exception) {
            invoke.reject(error.message ?: "Could not read photo")
        }
    }

    private fun createPhoto(name: String, mimeType: String): PendingPhoto {
        check(Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            "Saving photos to Pictures/GeoLibre requires Android 10 or newer"
        }
        val values = ContentValues().apply {
            put(MediaStore.Images.Media.DISPLAY_NAME, name)
            put(MediaStore.Images.Media.MIME_TYPE, mimeType)
            put(MediaStore.Images.Media.RELATIVE_PATH, "${Environment.DIRECTORY_PICTURES}/GeoLibre")
            put(MediaStore.Images.Media.IS_PENDING, 1)
        }
        val uri = requireNotNull(
            activity.contentResolver.insert(MediaStore.Images.Media.EXTERNAL_CONTENT_URI, values)
        ) { "Could not create Pictures/GeoLibre photo" }
        return PendingPhoto(uri, name, mimeType)
    }

    private fun hasPhotoData(uri: Uri): Boolean = try {
        activity.contentResolver.openInputStream(uri).use { input -> input?.read() != -1 }
    } catch (_: Exception) {
        false
    }

    private fun publish(uri: Uri) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            activity.contentResolver.update(
                uri,
                ContentValues().apply { put(MediaStore.Images.Media.IS_PENDING, 0) },
                null,
                null
            )
        }
    }

    private fun photoObject(photo: PendingPhoto): JSObject = JSObject().apply {
        put("uri", photo.uri.toString())
        put("name", photo.name)
        put("mimeType", photo.mimeType)
        put("bearing", readBearing(photo.uri))
    }

    private fun sourceInfo(uri: Uri): PhotoInfo {
        val projection = arrayOf(MediaStore.MediaColumns.DISPLAY_NAME, MediaStore.MediaColumns.MIME_TYPE)
        activity.contentResolver.query(uri, projection, null, null, null).use { cursor ->
            if (cursor != null && cursor.moveToFirst()) {
                val name = cursor.getString(0) ?: "photo"
                val mime = cursor.getString(1) ?: activity.contentResolver.getType(uri) ?: "image/jpeg"
                require(mime.startsWith("image/") && mime != "image/svg+xml") { "Unsupported image type" }
                return PhotoInfo(name, mime)
            }
        }
        val mime = activity.contentResolver.getType(uri) ?: "image/jpeg"
        require(mime.startsWith("image/") && mime != "image/svg+xml") { "Unsupported image type" }
        return PhotoInfo("photo", mime)
    }

    private fun requireOwnedPhoto(uri: Uri) {
        require(uri.scheme == "content" && uri.authority == MediaStore.AUTHORITY) { "Invalid photo URI" }
        val projection = arrayOf(MediaStore.MediaColumns.RELATIVE_PATH, MediaStore.MediaColumns.MIME_TYPE)
        activity.contentResolver.query(uri, projection, null, null, null).use { cursor ->
            require(cursor != null && cursor.moveToFirst()) { "Photo is unavailable" }
            val path = cursor.getString(0) ?: ""
            val mime = cursor.getString(1) ?: ""
            require(path == "${Environment.DIRECTORY_PICTURES}/GeoLibre/" && mime.startsWith("image/")) {
                "Photo is outside Pictures/GeoLibre"
            }
        }
    }

    private fun readBearing(uri: Uri): Double? = try {
        activity.contentResolver.openInputStream(uri).use { input ->
            val value = input?.let { ExifInterface(it) }
                ?.getAttributeDouble(ExifInterface.TAG_GPS_IMG_DIRECTION, Double.NaN)
            value?.takeIf { it.isFinite() }?.let { ((it % 360.0) + 360.0) % 360.0 }
        }
    } catch (_: Exception) {
        null
    }

    private fun safeName(name: String, mimeType: String): String {
        val clean = name.replace(Regex("[^A-Za-z0-9._-]+"), "_").trim('_').take(100)
        if (clean.contains('.')) return clean
        val extension = when (mimeType.lowercase()) {
            "image/png" -> ".png"
            "image/webp" -> ".webp"
            "image/heic", "image/heif" -> ".heic"
            else -> ".jpg"
        }
        return (clean.ifEmpty { "photo" }) + extension
    }

    private fun timestamp(): String =
        SimpleDateFormat("yyyyMMdd_HHmmss_SSS", Locale.US).format(Date())
}
