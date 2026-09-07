plugins {
    id("com.android.library")
    id("org.jetbrains.kotlin.android")
}

android {
    namespace = "org.geolibre.fieldmedia"
    compileSdk = 36

    defaultConfig { minSdk = 24 }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_1_8
        targetCompatibility = JavaVersion.VERSION_1_8
    }
    kotlinOptions { jvmTarget = "1.8" }
}

dependencies {
    implementation("androidx.activity:activity:1.10.1")
    implementation("androidx.core:core-ktx:1.15.0")
    implementation("androidx.exifinterface:exifinterface:1.3.7")
    implementation(project(":tauri-android"))
}
