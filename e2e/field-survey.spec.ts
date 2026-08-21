import { expect, test } from "@playwright/test";
import { waitForMap } from "./helpers";

const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
  "base64"
);

function largeBmp(width = 1800, height = 1800): Buffer {
  const rowSize = Math.ceil((width * 3) / 4) * 4;
  const imageSize = rowSize * height;
  const bmp = Buffer.alloc(54 + imageSize);
  bmp.write("BM");
  bmp.writeUInt32LE(bmp.length, 2);
  bmp.writeUInt32LE(54, 10);
  bmp.writeUInt32LE(40, 14);
  bmp.writeInt32LE(width, 18);
  bmp.writeInt32LE(height, 22);
  bmp.writeUInt16LE(1, 26);
  bmp.writeUInt16LE(24, 28);
  bmp.writeUInt32LE(imageSize, 34);
  return bmp;
}

async function openFieldCollection(page: import("@playwright/test").Page) {
  await waitForMap(page);
  await page.getByRole("button", { name: "Controls" }).click();
  await page.getByRole("menuitem", { name: "Field Collection" }).click();
}

async function addImage(
  page: import("@playwright/test").Page,
  input: "#fc-photo" | "#fc-camera",
  large = false
) {
  await page.locator(input).setInputFiles({
    name: large ? "large-camera.bmp" : "field-photo.png",
    mimeType: large ? "image/bmp" : "image/png",
    buffer: large ? largeBmp() : PNG,
  });
}

test("preserves marker shapes and selects field icons", async ({ page }) => {
  await openFieldCollection(page);
  await page.getByRole("button", { name: "Create layer" }).click();

  const shape = page.locator("#fc-marker-shape");
  expect(
    await shape
      .locator("option")
      .evaluateAll((options) =>
        options.map((option) => (option as HTMLOptionElement).value)
      )
  ).toEqual([
    "circle",
    "square",
    "triangle",
    "diamond",
    "star",
    "cross",
    "pin",
    "custom",
  ]);

  const icons = page.getByRole("group", { name: "Field icon" });
  for (const name of [
    "Reservoir",
    "Hydrological station",
    "Water-level station",
    "Rain gauge",
    "House",
    "Bridge",
  ]) {
    const button = icons.getByRole("button", { name });
    await expect(button.locator("img")).toHaveAttribute(
      "src",
      /^data:image\/svg\+xml/
    );
  }

  const reservoir = icons.getByRole("button", { name: "Reservoir" });
  await reservoir.click();
  await expect(reservoir).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator("#fc-marker-shape")).toHaveValue("custom");
});

test("edits notes and photos on a saved field observation", async ({
  page,
}) => {
  await openFieldCollection(page);
  await page.getByRole("button", { name: "Create layer" }).click();
  await page.getByRole("button", { name: "Pick on map" }).click();
  await expect(page.locator("[data-field-collection-marker]")).toBeVisible();
  await page
    .locator(".maplibregl-canvas")
    .click({ position: { x: 200, y: 200 } });

  await expect(page.locator("#fc-camera")).toHaveAttribute(
    "capture",
    "environment"
  );
  await page
    .getByRole("textbox", { name: "Note 1", exact: true })
    .fill("Original note");
  await page.getByRole("button", { name: "Add note" }).click();
  await page
    .getByRole("textbox", { name: "Note 2", exact: true })
    .fill("Remove me");
  await addImage(page, "#fc-photo", true);
  const firstPhoto = page.getByRole("button", {
    name: "Open photo 1 fullscreen",
  });
  await expect(firstPhoto).toBeVisible();
  await expect(firstPhoto.locator("img")).toHaveAttribute(
    "src",
    /^data:image\/jpeg;base64,/
  );
  await firstPhoto.click();
  const photoViewer = page.getByRole("dialog", {
    name: "Fullscreen photo viewer",
  });
  await expect(photoViewer.getByText("1 / 1")).toBeVisible();
  await photoViewer.getByRole("button", { name: "Close" }).click();
  await expect(photoViewer).toHaveCount(0);
  await page.getByRole("button", { name: "Save and continue" }).click();
  await expect(page.getByRole("button", { name: "Use GPS" })).toBeFocused();

  const savedObservations = page.getByText("Saved observations (1)");
  await savedObservations.click();
  const editObservation = page.getByRole("button", {
    name: "Edit observation 1",
  });
  const summaryBox = await savedObservations.boundingBox();
  const editBox = await editObservation.boundingBox();
  expect(summaryBox!.height).toBeGreaterThanOrEqual(44);
  expect(editBox!.height).toBeGreaterThanOrEqual(44);
  expect(editBox!.width).toBeGreaterThanOrEqual(44);
  await editObservation.click();
  await expect(
    page.getByRole("textbox", { name: "Note 1", exact: true })
  ).toHaveValue("Original note");
  await expect(
    page.getByRole("textbox", { name: "Observation name", exact: true })
  ).toBeFocused();
  await expect(
    page.getByRole("textbox", { name: "Note 2", exact: true })
  ).toHaveValue("Remove me");

  await page
    .getByRole("textbox", { name: "Note 1", exact: true })
    .fill("Updated after save");
  await page.getByRole("button", { name: "Remove note 2" }).click();
  await page.getByRole("button", { name: "Remove photo 1" }).click();
  await page.evaluate(() => {
    Object.defineProperty(window, "DeviceOrientationEvent", {
      configurable: true,
      value: { requestPermission: async () => "granted" },
    });
  });
  await page.getByRole("button", { name: "Take photo" }).click();
  await expect(
    page.getByText("Camera direction is enabled. Tap Take photo again.")
  ).toBeVisible();
  const chooserPromise = page.waitForEvent("filechooser");
  await page.getByRole("button", { name: "Take photo" }).click();
  const chooser = await chooserPromise;
  await chooser.setFiles({
    name: "field-photo.png",
    mimeType: "image/png",
    buffer: PNG,
  });
  await expect(
    page.getByRole("button", { name: "Open photo 1 fullscreen" })
  ).toBeVisible();
  await page.getByRole("button", { name: "Update observation" }).click();
  await expect(page.getByText(/Updated the observation/)).toBeVisible();
  await expect(page.getByText("Saved observations (1)")).toBeFocused();

  await page.getByText("Saved observations (1)").click();
  await page.getByRole("button", { name: "Edit observation 1" }).click();
  await expect(
    page.getByRole("textbox", { name: "Note 1", exact: true })
  ).toHaveValue("Updated after save");
  await expect(
    page.getByRole("textbox", { name: "Note 2", exact: true })
  ).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Open photo 1 fullscreen" })
  ).toBeVisible();
});

test("shows the three-step flow and supports save-and-continue separately from save", async ({
  page,
}) => {
  await openFieldCollection(page);
  await page.getByRole("button", { name: "Create layer" }).click();

  const workflow = page.getByRole("list", {
    name: "Observation collection steps",
  });
  await expect(
    workflow.locator("li").filter({ hasText: "Location" })
  ).toBeVisible();
  await expect(
    workflow.locator("li").filter({ hasText: "Form" })
  ).toBeVisible();
  await expect(
    workflow.locator("li").filter({ hasText: "Attachments" })
  ).toBeVisible();
  await expect(page.locator("[data-field-collection-form]")).toHaveCount(0);
  await expect(page.locator("[data-field-collection-attachments]")).toHaveCount(
    0
  );

  await page.getByRole("button", { name: "Pick on map" }).click();
  await page
    .locator(".maplibregl-canvas")
    .click({ position: { x: 160, y: 180 } });
  await workflow.getByRole("button", { name: /Attachments/ }).click();
  await expect(
    workflow
      .locator('li[aria-current="step"]')
      .filter({ hasText: "Attachments" })
  ).toBeVisible();
  await page.getByRole("button", { name: "Save and continue" }).click();
  await expect(page.getByText("Saved observations (1)")).toBeVisible();
  await expect(page.getByRole("button", { name: "Pick on map" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Use GPS" })).toBeFocused();
  await expect(
    page.getByRole("button", { name: "Save and continue" })
  ).toHaveCount(0);

  await page.getByRole("button", { name: "Pick on map" }).click();
  await page
    .locator(".maplibregl-canvas")
    .click({ position: { x: 260, y: 230 } });
  await page.getByRole("button", { name: "Save and continue" }).click();
  await expect(page.getByText("Saved observations (2)")).toBeVisible();

  await page.getByRole("button", { name: "Pick on map" }).click();
  await page
    .locator(".maplibregl-canvas")
    .click({ position: { x: 300, y: 260 } });
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(
    page.getByRole("dialog", { name: "Field Collection" })
  ).toHaveCount(0);
});

test("announces validation and focuses the first invalid field", async ({
  page,
}) => {
  await openFieldCollection(page);
  await page.getByRole("button", { name: "Add field" }).click();
  await page.getByRole("textbox", { name: "Label" }).fill("Species");
  await page.getByRole("checkbox", { name: "Required" }).check();
  await page.getByRole("button", { name: "Create layer" }).click();
  await page.getByRole("button", { name: "Pick on map" }).click();
  await page
    .locator(".maplibregl-canvas")
    .click({ position: { x: 200, y: 200 } });

  await page.getByRole("button", { name: "Save", exact: true }).click();
  const species = page.getByRole("textbox", { name: "Species" });
  await expect(species).toBeFocused();
  await expect(species).toHaveAttribute("aria-invalid", "true");
  await expect(species).toHaveAttribute("aria-describedby", "fc-species-error");
  await expect(page.getByRole("alert")).toHaveText("This field is required.");
});

test("uses a full-screen mobile dialog with persistent 44px controls", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await openFieldCollection(page);
  await page.getByRole("button", { name: "Create layer" }).click();

  const dialog = page.getByRole("dialog", { name: "Field Collection" });
  const box = await dialog.boundingBox();
  expect(box).not.toBeNull();
  expect(box!.x).toBeLessThanOrEqual(1);
  expect(box!.y).toBeLessThanOrEqual(1);
  expect(box!.width).toBeGreaterThanOrEqual(389);
  expect(box!.height).toBeGreaterThanOrEqual(843);

  for (const name of ["Use GPS", "Pick on map", "Close"]) {
    const target = page.getByRole("button", { name, exact: true }).last();
    const targetBox = await target.boundingBox();
    expect(targetBox, `${name} is visible`).not.toBeNull();
    expect(targetBox!.height, `${name} height`).toBeGreaterThanOrEqual(44);
    expect(targetBox!.width, `${name} width`).toBeGreaterThanOrEqual(44);
  }

  await page.setViewportSize({ width: 844, height: 390 });
  const landscapeBox = await dialog.boundingBox();
  expect(landscapeBox!.x).toBeLessThanOrEqual(1);
  expect(landscapeBox!.y).toBeLessThanOrEqual(1);
  expect(landscapeBox!.width).toBeGreaterThanOrEqual(843);
  expect(landscapeBox!.height).toBeGreaterThanOrEqual(389);
});
