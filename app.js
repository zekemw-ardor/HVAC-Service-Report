// ================================
// DATABASE SETUP
// ================================

const DB_NAME = "hvacServiceDB";
const DB_VERSION = 2; // incremented for blob structure
const STORE_NAME = "reports";
let db;

function initDB() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = (e) => {
      db = e.target.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: "id" });
      }
    };

    request.onsuccess = (e) => {
      db = e.target.result;
      resolve();
    };

    request.onerror = (e) => reject(e);
  });
}

// ================================
// SAVE STATUS UI
// ================================

const saveStatus = document.getElementById("saveStatus");

function showSaveStatus(text) {
  if (!saveStatus) return;
  saveStatus.textContent = text;
  setTimeout(() => (saveStatus.textContent = ""), 1500);
}

// ================================
// DEBOUNCE
// ================================

function debounce(func, delay = 800) {
  let timeout;
  return (...args) => {
    clearTimeout(timeout);
    timeout = setTimeout(() => func.apply(this, args), delay);
  };
}

// ================================
// FORM DATA COLLECTION
// ================================

function collectFormData() {
  const data = {
    id: "current",
    fields: {},
    radios: {},
    photos: photoManager.getAllPhotos(),
    signatures: signatureManager.getAllSignatures(),
    systems: collectSystemEquipment(),
    errorCodes: collectErrorCodes()
  };

  document.querySelectorAll("input, textarea").forEach(el => {
    if (el.type === "radio") {
      if (el.checked) data.radios[el.name] = el.value;
    } else if (el.id) {
      data.fields[el.id] = el.value;
    }
  });

  return data;
}

// ================================
// SAVE TO INDEXEDDB
// ================================

async function saveReport() {
  const tx = db.transaction(STORE_NAME, "readwrite");
  const store = tx.objectStore(STORE_NAME);
  const data = collectFormData();
  store.put(data);
  showSaveStatus("Saved");
}

const debouncedSave = debounce(saveReport);

// ================================
// RESTORE
// ================================

async function restoreReport() {
  const tx = db.transaction(STORE_NAME, "readonly");
  const store = tx.objectStore(STORE_NAME);
  const request = store.get("current");

  request.onsuccess = () => {
    const data = request.result;
    if (!data) return;

    // Restore fields
    Object.entries(data.fields || {}).forEach(([id, value]) => {
      const el = document.getElementById(id);
      if (el) el.value = value;
    });

    // Restore radios
    Object.entries(data.radios || {}).forEach(([name, value]) => {
      const radio = document.querySelector(
        `input[name="${name}"][value="${value}"]`
      );
      if (radio) radio.checked = true;
    });

    // Restore photos
    photoManager.restorePhotos(data.photos || {});
    signatureManager.restoreSignatures(data.signatures || {});
    restoreConditionals();
    calculateDeltaT();

    // Restore systems
  if (data.systems && data.systems.length) {
    const container = document.getElementById("systemEquipmentContainer");
    container.innerHTML = "";

  data.systems.forEach(system => {
    addSystemUnit(system);  // uses prefill
  });
  }
  restoreErrorCodes(data.errorCodes || []);
  };
}

// ================================
// PHOTO MANAGER (BLOB BASED)
// ================================

const photoManager = (() => {
  const photoState = {};
  const objectURLs = {};

  function init() {
    document.querySelectorAll(".photo-group").forEach(group => {
      const field = group.dataset.field;
      photoState[field] = [];
      objectURLs[field] = [];

      const btn = group.querySelector(".add-photo-btn");
      btn.addEventListener("click", () => {
        const input = document.createElement("input");
        input.type = "file";
        input.accept = "image/*";
        input.multiple = true;

        input.onchange = async (e) => {
  const files = Array.from(e.target.files);

  for (const file of files) {
    await addPhoto(field, file);
  }

  debouncedSave();
};

        input.click();
      });
    });
  }

 async function addPhoto(field, file) {
  const compressedBlob = await compressImage(file);
  photoState[field].push(compressedBlob);
  render(field);
}

  function deletePhoto(field, index) {
    URL.revokeObjectURL(objectURLs[field][index]);
    photoState[field].splice(index, 1);
    objectURLs[field].splice(index, 1);
    render(field);
    debouncedSave();
  }

  function render(field) {
    const group = document.querySelector(
      `.photo-group[data-field="${field}"]`
    );
    const container = group.querySelector(".photo-preview-container");
    container.innerHTML = "";
    objectURLs[field] = [];

    photoState[field].forEach((blob, index) => {
      const url = URL.createObjectURL(blob);
      objectURLs[field].push(url);

      const wrapper = document.createElement("div");
      wrapper.className = "photo-thumb";

      const img = document.createElement("img");
      img.src = url;

      const del = document.createElement("button");
      del.type = "button";
      del.textContent = "✕";
      del.onclick = () => deletePhoto(field, index);

      wrapper.appendChild(img);
      wrapper.appendChild(del);
      container.appendChild(wrapper);
    });
  }

  function getAllPhotos() {
    return photoState;
  }

  function restorePhotos(savedPhotos) {
    Object.entries(savedPhotos).forEach(([field, blobs]) => {
      photoState[field] = blobs || [];
      render(field);
    });
  }

function compressImage(file) {
  return new Promise((resolve) => {
    const img = new Image();
    const reader = new FileReader();

    reader.onload = (e) => {
      img.src = e.target.result;
    };

    img.onload = () => {
      const canvas = document.createElement("canvas");
      const ctx = canvas.getContext("2d");

      const MAX_SIZE = 1200;
      let width = img.width;
      let height = img.height;

      if (width > height && width > MAX_SIZE) {
        height *= MAX_SIZE / width;
        width = MAX_SIZE;
      } else if (height > MAX_SIZE) {
        width *= MAX_SIZE / height;
        height = MAX_SIZE;
      }

      canvas.width = width;
      canvas.height = height;

      ctx.drawImage(img, 0, 0, width, height);

      canvas.toBlob(
        (blob) => {
          if (blob) {
            resolve(blob);
          } else {
            resolve(file);
          }
        },
        "image/jpeg",
        0.7
      );
    }; // ✅ THIS WAS MISSING

    reader.readAsDataURL(file);
  });
}

  return { init, getAllPhotos, restorePhotos };
})();


// ================================
// SIGNATURE MANAGER
// ================================

const signatureManager = (() => {

  const signatureState = {};
  const objectURLs = {};

  function init() {
    document.querySelectorAll(".signature-block").forEach(block => {

      const type = block.dataset.signature;
      const canvas = block.querySelector(".signature-canvas");
      const clearBtn = block.querySelector(".clear-signature-btn");

      const ctx = canvas.getContext("2d");
      resizeCanvas(canvas);

      let drawing = false;

      function start(e) {
        drawing = true;
        draw(e);
      }

      function end() {
        drawing = false;
        ctx.beginPath();
        saveSignature(type, canvas);
      }

      function draw(e) {
        if (!drawing) return;

        const rect = canvas.getBoundingClientRect();
        const x = (e.touches ? e.touches[0].clientX : e.clientX) - rect.left;
        const y = (e.touches ? e.touches[0].clientY : e.clientY) - rect.top;

        ctx.lineWidth = 2;
        ctx.lineCap = "round";
        ctx.strokeStyle = "#000";

        ctx.lineTo(x, y);
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(x, y);
      }

      canvas.addEventListener("mousedown", start);
      canvas.addEventListener("mousemove", draw);
      canvas.addEventListener("mouseup", end);
      canvas.addEventListener("mouseout", end);

      canvas.addEventListener("touchstart", start);
      canvas.addEventListener("touchmove", draw);
      canvas.addEventListener("touchend", end);

      clearBtn.addEventListener("click", () => {
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        signatureState[type] = null;
        debouncedSave();
      });
    });
  }

  function resizeCanvas(canvas) {
    const ratio = window.devicePixelRatio || 1;
    canvas.width = canvas.offsetWidth * ratio;
    canvas.height = canvas.offsetHeight * ratio;
    canvas.getContext("2d").scale(ratio, ratio);
  }

  function saveSignature(type, canvas) {
    canvas.toBlob(blob => {
      if (blob) {
        signatureState[type] = blob;
        debouncedSave();
      }
    }, "image/png");
  }

  function getAllSignatures() {
    return signatureState;
  }

  function restoreSignatures(saved) {
    Object.entries(saved).forEach(([type, blob]) => {
      if (!blob) return;

      signatureState[type] = blob;

      const block = document.querySelector(
        `.signature-block[data-signature="${type}"]`
      );

      const canvas = block.querySelector(".signature-canvas");
      const ctx = canvas.getContext("2d");
      resizeCanvas(canvas);

      const url = URL.createObjectURL(blob);
      const img = new Image();

      img.onload = () => {
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        URL.revokeObjectURL(url);
      };

      img.src = url;
    });
  }

  return { init, getAllSignatures, restoreSignatures };

})();

// ================================
// CONDITIONAL LOGIC
// ================================

function restoreConditionals() {
  document.querySelectorAll(".conditional").forEach(section => {
    const radioGroup = section.previousElementSibling?.querySelectorAll(
      "input[type='radio']"
    );
    if (!radioGroup) return;

    radioGroup.forEach(radio => {
      if (radio.checked && radio.value === "yes") {
        section.classList.remove("hidden");
      }
    });
  });
}

document.addEventListener("change", (e) => {
  if (e.target.type === "radio") {
    const group = e.target.closest(".yesno-group");
    const conditional = group?.nextElementSibling;
    if (conditional?.classList.contains("conditional")) {
      conditional.classList.toggle(
        "hidden",
        e.target.value !== "yes"
      );
    }
    debouncedSave();
  }
});

// ================================
// DELTA T AUTO CALC
// ================================

function calculateDeltaT() {
  const entering = parseFloat(document.getElementById("enteringTemp")?.value);
  const leaving = parseFloat(document.getElementById("leavingTemp")?.value);
  const deltaField = document.getElementById("deltaT");

  if (!isNaN(entering) && !isNaN(leaving)) {
    deltaField.value = entering - leaving;
  }
}

document.getElementById("enteringTemp")?.addEventListener("input", () => {
  calculateDeltaT();
  debouncedSave();
});

document.getElementById("leavingTemp")?.addEventListener("input", () => {
  calculateDeltaT();
  debouncedSave();
});



// ===============================
// SYSTEM EQUIPMENT
// ===============================

function createEquipmentBlock(type) {
  const block = document.createElement("div");
  block.classList.add("equipment-block");

  block.innerHTML = `
    <label>
      Model #
      <input type="text" class="${type}-model" />
    </label>
    <label>
      Serial #
      <input type="text" class="${type}-serial" />
    </label>
  `;

  return block;
}

function addSystemUnit(prefillData = null) {
  const container = document.getElementById("systemEquipmentContainer");
  if (!container) return;

  const systemCount = container.children.length + 1;

  const wrapper = document.createElement("div");
  wrapper.classList.add("system-wrapper");

  const headerRow = document.createElement("div");
  headerRow.classList.add("system-header");

  const header = document.createElement("h4");
  header.innerText = `System ${systemCount}`;

  const removeBtn = document.createElement("button");
  removeBtn.type = "button";
  removeBtn.innerText = "Remove";
  removeBtn.classList.add("remove-system-btn");

  removeBtn.addEventListener("click", () => {
    wrapper.remove();
    renumberSystems();
    debouncedSave();
  });

  headerRow.appendChild(header);
  headerRow.appendChild(removeBtn);

  const equipmentBlock = createEquipmentBlock("system");

  wrapper.appendChild(headerRow);
  wrapper.appendChild(equipmentBlock);

  container.appendChild(wrapper);

  // Prefill if restoring
  if (prefillData) {
    wrapper.querySelector(".system-model").value = prefillData.model || "";
    wrapper.querySelector(".system-serial").value = prefillData.serial || "";
  }
}

function renumberSystems() {
  const wrappers = document.querySelectorAll(".system-wrapper");
  wrappers.forEach((wrapper, index) => {
    const header = wrapper.querySelector("h4");
    header.innerText = `System ${index + 1}`;
  });
}

function collectSystemEquipment() {
  const systems = [];

  document.querySelectorAll(".system-wrapper").forEach(wrapper => {
    const model = wrapper.querySelector(".system-model")?.value || "";
    const serial = wrapper.querySelector(".system-serial")?.value || "";

    systems.push({ model, serial });
  });

  return systems;
}


// ===============================
// ERROR CODE HANDLING
// ===============================

function addErrorCode(value = "") {
  const container = document.getElementById("extErrorCodeContainer");
  if (!container) return;

  const wrapper = document.createElement("div");
  wrapper.classList.add("error-code-wrapper");

  const input = document.createElement("input");
  input.type = "text";
  input.maxLength = 2;
  input.pattern = "[A-Za-z0-9]{2}";
  input.value = value;

  const removeBtn = document.createElement("button");
  removeBtn.type = "button";
  removeBtn.textContent = "Remove";

  removeBtn.addEventListener("click", () => {
    wrapper.remove();
    debouncedSave();
  });

  wrapper.appendChild(input);
  wrapper.appendChild(removeBtn);
  container.appendChild(wrapper);
}

function collectErrorCodes() {
  const codes = [];

  document.querySelectorAll("#extErrorCodeContainer input").forEach(input => {
    if (input.value.trim()) {
      codes.push(input.value.trim());
    }
  });

  return codes;
}

function restoreErrorCodes(savedCodes) {
  const container = document.getElementById("extErrorCodeContainer");
  if (!container) return;

  container.innerHTML = "";

  if (!savedCodes || !savedCodes.length) {
    addErrorCode(); // at least one blank
    return;
  }

  savedCodes.forEach(code => addErrorCode(code));
}

// ================================
// GENERAL INPUT AUTOSAVE
// ================================

document.addEventListener("input", (e) => {
  if (e.target.type !== "file") {
    debouncedSave();
  }
});

// ================================
// INIT
// ================================

document.addEventListener("DOMContentLoaded", async () => {
  await initDB();
  photoManager.init();
  signatureManager.init();

  document
    .getElementById("addSystemUnit")
    ?.addEventListener("click", () => {
      addSystemUnit();
      debouncedSave();
    });

  restoreReport();
  document
  .getElementById("addExtErrorCodeBtn")
  ?.addEventListener("click", () => {
    addErrorCode();
    debouncedSave();
  });

  document.getElementById("generatePdf")
  ?.addEventListener("click", generatePDF);
});

// ================================
// PDF EXPORT SYSTEM
// ================================

async function generatePDF() {
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF();

  const data = collectFormData();

  let y = 20;
  const pageHeight = doc.internal.pageSize.height;

  function addLine(text, spacing = 8) {
  if (y > pageHeight - 20) {
    doc.addPage();
    y = 20;
  }

  if (text === null || text === undefined) {
    text = "";
  }

  if (typeof text !== "string") {
    try {
      text = JSON.stringify(text);
    } catch (e) {
      text = String(text);
    }
  }

  doc.text(text, 20, y);
  y += spacing;
}

  function addSectionTitle(title) {
    if (y > pageHeight - 30) {
      doc.addPage();
      y = 20;
    }
    doc.setFont(undefined, "bold");
    doc.text(title, 20, y);
    doc.setFont(undefined, "normal");
    y += 10;
  }

// ====================
// HEADER
// ====================
doc.setFontSize(16);
doc.text("Service Report", 20, y);
y += 12;

doc.setFontSize(11);

// Build customer + address properly
const fullName = `${data.fields.customerFirstName || ""} ${data.fields.customerLastName || ""}`.trim();

const fullAddress = [
  data.fields.address1,
  data.fields.address2,
  data.fields.city,
  data.fields.state,
  data.fields.zip
]
.filter(Boolean)
.join(", ");

addLine(`Customer: ${fullName}`);
addLine(`Address: ${fullAddress}`);
addLine(`Date: ${data.fields.serviceDate || ""}`);
addLine(`Technician: ${data.fields.technicianName || ""}`);
y += 6;

  // ====================
  // SYSTEM EQUIPMENT
  // ====================
  if (data.systems && data.systems.length) {
    addSectionTitle("System Equipment");

    data.systems.forEach((system, index) => {
      addLine(`System ${index + 1}`);
      addLine(`Model: ${system.model}`);
      addLine(`Serial: ${system.serial}`);
      y += 4;
    });
  }

// ====================
// CUSTOMER NOTES
// ====================
if (data.fields.customerNotes) {
  addSectionTitle("Customer Notes");

  const splitText = doc.splitTextToSize(data.fields.customerNotes, 170);
  splitText.forEach(line => addLine(line, 6));
}
y += 12;

// ====================
// ERROR CODES
// ====================
if (data.errorCodes && data.errorCodes.length) {
  addSectionTitle("Error Codes");
  addLine(data.errorCodes.join(", "));
}

y += 12;

// ====================
// INSPECTION RESULTS
// ====================

addSectionTitle("Inspection Results");

// -------- EXTERIOR --------
addSectionTitle("Exterior");

// Pre Photo
if (data.radios.extPrePhoto)
  addLine(`Pre-service photo taken: ${data.radios.extPrePhoto}`);

// Discoloration
if (data.radios.extCorrosion) {
  addLine(`Discoloration / Corrosion present: ${data.radios.extCorrosion}`);

  if (data.fields.extCorrosionNotes) {
    const splitText = doc.splitTextToSize(data.fields.extCorrosionNotes, 170);
    splitText.forEach(line => addLine(`  - ${line}`, 6));
  }
}
y += 12;

// LED Error Codes
if (data.errorCodes?.length)
  addLine(`LED Error Codes: ${data.errorCodes.join(", ")}`);

y += 6;

// Wiring Corrosion
if (data.radios.extWireCorrosion) {
  addLine(`Wiring corrosion: ${data.radios.extWireCorrosion}`);

  if (data.fields.extWireCorrosionNotes) {
    const splitText = doc.splitTextToSize(data.fields.extWireCorrosionNotes, 170);
    splitText.forEach(line => addLine(`  - ${line}`, 6));
  }
}
y += 12;

// Megohm
if (data.fields.megohmResult)
  addLine(`Megohm Test Result: ${data.fields.megohmResult}`);

// Flare Torque
if (data.radios.flareTorque)
  addLine(`Inspect flare fittings properly torque'd: ${data.radios.flareTorque}`);

// Post Photo
if (data.radios.extPostPhoto)
  addLine(`Post-service photo taken: ${data.radios.extPostPhoto}`);
y += 8;

// -------- INTERIOR --------
addSectionTitle("Interior");

// Pre Photo
if (data.radios.intPrePhoto)
  addLine(`Pre-service photo taken: ${data.radios.intPrePhoto}`);

// Condensate
if (data.radios.condensateClean)
  addLine(`Condensate line blown out: ${data.radios.condensateClean}`);

if (data.radios.condensateDrain)
  addLine(`Condensate line drains properly: ${data.radios.condensateDrain}`);

// Proper Voltage
if (data.radios.properVoltage) {
  addLine(`Unit running at proper voltage: ${data.radios.properVoltage}`);

  if (data.fields.voltageReading) {
    addLine(`Voltage Reading: ${data.fields.voltageReading}`);
  }
}

// Flare fittings
if (data.radios.intFlareTorque)
  addLine(`Inspect flare fittings are properly torque'd: ${data.radios.intFlareTorque}`);

// Dust filter
if (data.radios.dustFilter)
  addLine(`Replaced dust filters: ${data.radios.dustFilter}`);

// Post Photo
if (data.radios.intPostPhoto)
  addLine(`Post-service photo taken: ${data.radios.intPostPhoto}`);

y += 8;

// ====================
// TEMPERATURE READINGS
// ====================
addSectionTitle("Temperature Readings");

if (data.fields.enteringTemp) {
  addLine(`Entering Air Temp (°F): ${data.fields.enteringTemp}`);
}

if (data.fields.leavingTemp) {
  addLine(`Leaving Air Temp (°F): ${data.fields.leavingTemp}`);
}

if (data.fields.deltaT) {
  addLine(`Delta T: ${data.fields.deltaT} °F`);
}

y += 12;

// ====================
// PHOTOS
// ====================
if (data.photos) {
  addSectionTitle("Photos");

  const orderedPhotoFields = [
    "extPrePhotoImage",
    "extCorrosionImage",
    "extWireCorrosionImage",
    "extPostPhotoImage",
    "intPrePhotoImage",
    "intPostPhotoImage"
  ];

  for (const field of orderedPhotoFields) {
    const blobs = data.photos[field];
    if (!blobs || !blobs.length) continue;

    addLine(formatLabel(field));

    for (const blob of blobs) {
      const dataUrl = await blobToDataURL(blob);

      if (y > pageHeight - 70) {
        doc.addPage();
        y = 20;
      }

      doc.addImage(dataUrl, "JPEG", 20, y, 80, 60);
      y += 70;
    }
  }
}

// ====================
// FINAL NOTES & RECOMMENDATIONS
// ====================

["finalNotes", "recommendations"].forEach(fieldId => {
  const value = data.fields[fieldId];
  if (!value) return;

  addSectionTitle(formatLabel(fieldId));

  const splitText = doc.splitTextToSize(value, 170);
  splitText.forEach(line => addLine(line, 6));

  y += 12; // spacing after each notes section
});

// ====================
// SIGNATURES
// ====================
if (data.signatures) {
  addSectionTitle("Signatures");

  for (const [key, sigBlob] of Object.entries(data.signatures)) {
    if (!sigBlob) continue;

    addLine(formatLabel(key));

const dataUrl = await blobToDataURL(sigBlob);

// Check if there's room for signature block
if (y > pageHeight - 40) {
  doc.addPage();
  y = 20;
}

doc.addImage(dataUrl, "PNG", 20, y, 60, 25);
y += 35;
  }
}

  // ====================
  // SAVE FILE
  // ====================
  const filename = buildFileName(data);
  doc.save(filename);
}

function formatLabel(name) {
  return name
    .replace(/([A-Z])/g, " $1")
    .replace(/_/g, " ")
    .replace(/^./, str => str.toUpperCase());
}

function buildFileName(data) {
  const customer = data.fields.customerName || "Report";
  const date = data.fields.date || new Date().toISOString().split("T")[0];
  return `${customer.replace(/\s+/g, "_")}_${date}.pdf`;
}

function blobToDataURL(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}