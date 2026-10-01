/* Med Track Wise: offline-first family medication tracker. */

const PROFILE_KEY = "medTrackProfiles";
let familyProfiles = readJSON(PROFILE_KEY, []);
let activeProfile = null;
let medicines = [];
let healthReadings = [];
let medicineReferences = [];
let adherenceLog = [];
let currentFamilyId = null;

function readJSON(key, fallback) {
    try {
        return JSON.parse(localStorage.getItem(key) || JSON.stringify(fallback));
    } catch {
        return fallback;
    }
}

function today() {
    const date = new Date();
    return new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
}

function escapeHTML(value) {
    return String(value ?? "").replace(/[&<>"']/g, character => ({
        "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
    })[character]);
}

function showPage(page) {
    document.querySelectorAll(".page").forEach(section => section.classList.add("hidden"));
    document.getElementById(page)?.classList.remove("hidden");
    renderAll();
}

function activateProfile(profile) {
    if (activeProfile) saveData();
    closeReminder();
    activeProfile = profile;
    currentFamilyId = profile.familyId || currentFamilyId;
    activeProfile.medicines ||= [];
    activeProfile.healthReadings ||= [];
    activeProfile.medicineReferences ||= [];
    activeProfile.adherenceLog ||= [];
    activeProfile.alertsSent ||= [];
    activeProfile.conversation ||= [];
    medicines = activeProfile.medicines;
    medicines.forEach(medicine => {
        medicine.stockCount = Number.isFinite(medicine.stockCount) ? medicine.stockCount : null;
        if (medicine.takenDate !== today()) medicine.taken = false;
    });
    healthReadings = activeProfile.healthReadings;
    medicineReferences = activeProfile.medicineReferences;
    adherenceLog = activeProfile.adherenceLog;
    document.querySelector(".topbar").classList.remove("hidden");
    document.querySelector("footer").classList.remove("hidden");
    populateProfileSelect();
    showPage("dashboard");
    updateAutomaticTheme();
    checkMedicationReminder();
}

function populateProfileSelect() {
    const select = document.getElementById("profileSelect");
    if (!select || !activeProfile) return;
    const members = familyProfiles.filter(profile => profile.familyId === currentFamilyId);
    select.innerHTML = members.map(profile =>
        `<option value="${escapeHTML(profile.id)}">${escapeHTML(profile.name)}</option>`
    ).join("");
    select.value = activeProfile.id;
}

function switchProfile(profileId) {
    const profile = familyProfiles.find(item => item.id === profileId && item.familyId === currentFamilyId);
    if (profile && profile.id !== activeProfile?.id) activateProfile(profile);
}

function savePatientName(event) {
    event.preventDefault();
    if (!activeProfile) return;
    const input = document.getElementById("patientNameInput");
    const name = input.value.trim();
    if (!name || name.length > 80) {
        input.setCustomValidity("Enter a patient name up to 80 characters.");
        input.reportValidity();
        input.setCustomValidity("");
        return;
    }
    updatePatientName(name);
}

function renamePatient() {
    if (!activeProfile) return;
    const name = window.prompt("Enter the patient's name:", activeProfile.name)?.trim();
    if (!name) return;
    if (name.length > 80) {
        alert("Patient names must be 80 characters or fewer.");
        return;
    }
    updatePatientName(name);
}

function updatePatientName(name) {
    activeProfile.name = name;
    saveData();
    populateProfileSelect();
    updateGreeting();
    updateCaregiver();
    updateHomeAlerts();
    showReminder("Patient name updated.");
}

function addFamilyProfile() {
    const familyMembers = familyProfiles.filter(profile => profile.familyId === currentFamilyId);
    if (familyMembers.length >= 3) {
        alert("This device already has three profiles in this family.");
        return;
    }
    const name = window.prompt("Enter a name for the new patient profile:")?.trim();
    if (!name) return;
    const profile = {
        id: crypto.randomUUID(),
        familyId: currentFamilyId,
        name,
        medicines: [],
        healthReadings: [],
        medicineReferences: [],
        adherenceLog: []
    };
    familyProfiles.push(profile);
    localStorage.setItem(PROFILE_KEY, JSON.stringify(familyProfiles));
    activateProfile(profile);
}

function saveData() {
    if (!activeProfile) return;
    activeProfile.medicines = medicines;
    activeProfile.healthReadings = healthReadings;
    activeProfile.medicineReferences = medicineReferences;
    activeProfile.adherenceLog = adherenceLog;
    familyProfiles = familyProfiles.map(profile => profile.id === activeProfile.id ? activeProfile : profile);
    try {
        localStorage.setItem(PROFILE_KEY, JSON.stringify(familyProfiles));
    } catch {
        showReminder("This device is low on storage. Export your data and remove some saved photos.");
    }
}

function formatTime(time) {
    if (!time) return "";
    const [hours, minutes] = time.split(":").map(Number);
    return `${hours % 12 || 12}:${String(minutes).padStart(2, "0")} ${hours >= 12 ? "PM" : "AM"}`;
}

function isScheduledOnDate(medicine, dateString) {
    if (medicine.startDate && dateString < medicine.startDate) return false;
    if (medicine.endDate && dateString > medicine.endDate) return false;
    const weekday = new Date(`${dateString}T12:00:00`).getDay();
    const days = Array.isArray(medicine.days) ? medicine.days : [0, 1, 2, 3, 4, 5, 6];
    return days.includes(weekday);
}

function scheduleDayNames(medicine) {
    const days = Array.isArray(medicine.days) ? medicine.days : [0, 1, 2, 3, 4, 5, 6];
    return days.length === 7 ? "Every day" : days.map(day => ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][day]).join(", ");
}

function adjustStock(id, change) {
    const medicine = medicines.find(item => Number(item.id) === id);
    if (!medicine) return;
    medicine.stockCount = Math.max(0, (Number(medicine.stockCount) || 0) + change);
    saveData();
    renderAll();
}

function setMedicineTakenState(medicine, isTaken) {
    medicine.taken = Boolean(isTaken);
    medicine.takenDate = isTaken ? today() : null;
}

function takeMedicine(id) {
    const medicine = medicines.find(item => Number(item.id) === Number(id));
    if (!medicine) return;
    const date = today();
    setMedicineTakenState(medicine, true);
    const existingLog = adherenceLog.find(entry => entry.date === date && Number(entry.medicineId) === Number(id));
    if (!existingLog) adherenceLog.push({ date, medicineId: Number(id) });
    saveData();
    renderAll();
    showReminder(`${medicine.name} marked as taken for today.`);
}

function getFilteredMedicines() {
    const search = (document.getElementById("searchMedicine")?.value || "").toLowerCase().trim();
    return search ? medicines.filter(item => item.name.toLowerCase().includes(search)) : medicines;
}

function medicineHTML(medicine, showDelete = false) {
    const takenToday = medicine.taken && medicine.takenDate === today();
    const instructions = medicine.instructions ? `<div class="medicine-info">${escapeHTML(medicine.instructions)}</div>` : "";
    const stock = Number.isFinite(medicine.stockCount)
        ? `<div class="medicine-stock ${medicine.stockCount <= (medicine.refillThreshold || 3) ? "stock-low" : ""}">${medicine.stockCount} unit(s) left <button class="stock-adjust" onclick="adjustStock(${Number(medicine.id)}, 1)">+ Refill</button></div>`
        : "";
    const photo = medicine.prescriptionImage
        ? `<img class="medicine-photo-thumb" src="${medicine.prescriptionImage}" alt="Prescription photo for ${escapeHTML(medicine.name)}">`
        : "";
    return `<article class="medicine"><div>${photo}<div class="medicine-name">💊 ${escapeHTML(medicine.name)}</div>
        <div class="medicine-info">${escapeHTML(medicine.dose)} · ${formatTime(medicine.time)} · ${escapeHTML(medicine.frequency || "Daily")} · ${scheduleDayNames(medicine)}${medicine.startDate ? ` · from ${escapeHTML(medicine.startDate)}` : ""}${medicine.endDate ? ` · until ${escapeHTML(medicine.endDate)}` : ""}</div>${instructions}${stock}</div>
        <div class="medicine-actions">${takenToday ? `<span class="taken">✓ Taken</span>` : `<button class="take" onclick="takeMedicine(${Number(medicine.id)})">Mark Taken</button>`}
        <button class="icon-button speak-medicine" onclick="speakMedicine(${Number(medicine.id)})" aria-label="Read ${escapeHTML(medicine.name)} aloud" title="Read aloud">🔊</button>
        ${showDelete ? `<button class="delete" onclick="deleteMedicine(${Number(medicine.id)})">Delete</button>` : ""}</div></article>`;
}

function updateGreeting() {
    const heading = document.getElementById("greetingTitle");
    if (!heading) return;
    const hour = new Date().getHours();
    const greeting = hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";
    heading.textContent = `${greeting}, ${activeProfile?.name?.split(/\s+/)[0] || "there"}.`;
}

function compressImageFile(file) {
    return new Promise((resolve, reject) => {
        const image = new Image();
        const url = URL.createObjectURL(file);
        image.onload = () => {
            const scale = Math.min(1, 1400 / Math.max(image.width, image.height));
            const canvas = document.createElement("canvas");
            canvas.width = Math.max(1, Math.round(image.width * scale));
            canvas.height = Math.max(1, Math.round(image.height * scale));
            const context = canvas.getContext("2d");
            context.fillStyle = "#fff";
            context.fillRect(0, 0, canvas.width, canvas.height);
            context.drawImage(image, 0, 0, canvas.width, canvas.height);
            URL.revokeObjectURL(url);
            resolve(canvas.toDataURL("image/jpeg", 0.76));
        };
        image.onerror = () => {
            URL.revokeObjectURL(url);
            reject(new Error("Could not open image"));
        };
        image.src = url;
    });
}

async function addMedicine() {
    const name = document.getElementById("medicineName").value.trim();
    const dose = document.getElementById("medicineDose").value.trim();
    const time = document.getElementById("medicineTime").value;
    const frequency = document.getElementById("medicineFrequency").value;
    const instructions = document.getElementById("medicineInstructions").value.trim();
    const stockValue = document.getElementById("medicineStock").value;
    const unitsPerDose = Number(document.getElementById("medicineUnitsPerDose").value || 1);
    const startDate = document.getElementById("medicineStartDate").value || today();
    const endDate = document.getElementById("medicineEndDate").value;
    const days = [...document.querySelectorAll('input[name="medicineDay"]:checked')].map(input => Number(input.value));
    const prescriptionFile = document.getElementById("prescriptionPhoto").files[0];
    if (!name || !dose || !time) {
        alert("Enter the medicine name, dose, and time exactly as prescribed.");
        return;
    }
    if (stockValue !== "" && (!Number.isInteger(Number(stockValue)) || Number(stockValue) < 0)) {
        alert("Enter stock as a whole number of doses.");
        return;
    }
    if (!Number.isInteger(unitsPerDose) || unitsPerDose < 1) {
        alert("Enter a whole number of tablets or units per dose.");
        return;
    }
    if (endDate && endDate < startDate) {
        alert("The end date must be on or after the start date.");
        return;
    }
    if (!days.length) {
        alert("Choose at least one day for this medicine.");
        return;
    }
    let prescriptionImage = "";
    if (prescriptionFile) {
        try {
            prescriptionImage = await compressImageFile(prescriptionFile);
        } catch {
            alert("This prescription photo could not be saved. Try another image.");
            return;
        }
    }
    medicines.push({
        id: Date.now(), name, dose, time, frequency, instructions,
        stockCount: stockValue === "" ? null : Number(stockValue),
        unitsPerDose,
        refillThreshold: 3, prescriptionImage, taken: false, takenDate: null, days, startDate, endDate
    });
    saveData();
    ["medicineName", "medicineDose", "medicineTime", "medicineInstructions", "medicineStock", "prescriptionPhoto", "medicineStartDate", "medicineEndDate"].forEach(id => {
        document.getElementById(id).value = "";
    });
    document.getElementById("medicineUnitsPerDose").value = "1";
    document.getElementById("medicineStartDate").value = today();
    document.querySelectorAll('input[name="medicineDay"]').forEach(input => { input.checked = true; });
    document.getElementById("prescriptionPreview").classList.add("hidden");
    renderAll();
    showReminder(`${name} was added to ${activeProfile.name}'s schedule.`);
}

function deleteMedicine(id) {
    const medicine = medicines.find(item => item.id === id);
    if (!medicine || !confirm(`Delete ${medicine.name} from this profile?`)) return;
    medicines = medicines.filter(item => item.id !== id);
    saveData();
    renderAll();
}

function updateHomeAlerts() {
    const container = document.getElementById("homeAlerts");
    if (!container) return;
    const currentTime = new Date().toTimeString().slice(0, 5);
    const overdue = medicines.filter(item => isScheduledOnDate(item, today()) && !item.taken && item.time < currentTime);
    const lowStock = medicines.filter(item => Number.isFinite(item.stockCount) && item.stockCount <= (item.refillThreshold || 3));
    const next = medicines.filter(item => isScheduledOnDate(item, today()) && !item.taken && item.time >= currentTime).sort((a, b) => a.time.localeCompare(b.time))[0];
    const alerts = [];
    if (!medicines.length) alerts.push(`<div class="alert-item alert-stock"><strong>No schedule yet.</strong> Add medicines prescribed for ${escapeHTML(activeProfile?.name || "this patient")}.</div>`);
    overdue.forEach(item => alerts.push(`<div class="alert-item alert-urgent"><strong>Missed dose:</strong> ${escapeHTML(item.name)} · ${escapeHTML(item.dose)} · ${formatTime(item.time)} <button class="take" onclick="takeMedicine(${Number(item.id)})">Mark Taken</button></div>`));
    lowStock.forEach(item => alerts.push(`<div class="alert-item alert-stock"><strong>Refill reminder:</strong> ${escapeHTML(item.name)} has ${item.stockCount} unit(s) left.</div>`));
    if (next) alerts.push(`<div class="alert-item alert-next"><strong>Next:</strong> ${escapeHTML(next.name)}, ${escapeHTML(next.dose)} at ${formatTime(next.time)}${next.instructions ? ` · ${escapeHTML(next.instructions)}` : ""}</div>`);
    container.innerHTML = alerts.join("") || `<div class="alert-item alert-clear">No urgent alerts. You're all caught up.</div>`;
}

function updateDashboard() {
    const todaysMedicines = medicines.filter(item => isScheduledOnDate(item, today()));
    const taken = todaysMedicines.filter(item => item.taken && item.takenDate === today()).length;
    const todayList = getFilteredMedicines().filter(item => isScheduledOnDate(item, today()));
    const setText = (id, value) => { const node = document.getElementById(id); if (node) node.textContent = value; };
    setText("medicineCount", todaysMedicines.length);
    setText("takenCount", taken);
    setText("pendingCount", todaysMedicines.length - taken);
    setText("adherence", `${todaysMedicines.length ? Math.round(taken / todaysMedicines.length * 100) : 0}%`);
    updateGreeting();
    updateHomeAlerts();
    const container = document.getElementById("dashboardMedicines");
    if (container) container.innerHTML = todayList.map(item => medicineHTML(item)).join("") || `<p class="empty">No medicines scheduled for this patient today.</p>`;
}

function updateMedicineList() {
    const container = document.getElementById("medicineList");
    if (container) container.innerHTML = medicines.map(item => medicineHTML(item, true)).join("") || `<p>No medicines added for this patient.</p>`;
}

function speakMedicine(id) {
    const item = medicines.find(medicine => medicine.id === id);
    if (!item) return;
    speakText(`${item.name}. Dose: ${item.dose}. Scheduled for ${formatTime(item.time)}. ${item.taken && item.takenDate === today() ? "Marked taken." : "Not yet marked taken."} ${item.instructions || ""}`);
}

function speakDashboard() {
    const plan = medicines.filter(item => isScheduledOnDate(item, today())).sort((a, b) => a.time.localeCompare(b.time));
    if (!plan.length) return speakText(`There are no medicines scheduled for ${activeProfile.name}.`);
    speakText(`Today's medicine timetable for ${activeProfile.name}. ${plan.map(item => `${formatTime(item.time)}, ${item.name}, ${item.dose}${item.instructions ? `, ${item.instructions}` : ""}, ${item.taken && item.takenDate === today() ? "taken" : "pending"}`).join(". ")}`);
}

function updateSchedule() {
    const container = document.getElementById("scheduleList");
    if (!container) return;
    const day = new Date().toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" });
    const sorted = medicines.filter(item => isScheduledOnDate(item, today())).sort((a, b) => a.time.localeCompare(b.time));
    container.innerHTML = sorted.length
        ? `<p class="field-help">${escapeHTML(activeProfile?.name || "Patient")} · ${escapeHTML(day)}</p>${sorted.map(item => medicineHTML(item)).join("")}`
        : `<p>No medicines scheduled for this profile yet.</p>`;
}

function calculateAdherence() {
    const todays = medicines.filter(item => isScheduledOnDate(item, today()));
    return todays.length ? Math.round(todays.filter(item => item.taken && item.takenDate === today()).length / todays.length * 100) : 0;
}

function updateWeeklyChart() {
    const container = document.getElementById("weeklyChart");
    if (!container) return;
    const rows = [];
    for (let offset = 6; offset >= 0; offset--) {
        const date = new Date();
        date.setDate(date.getDate() - offset);
        const dateKey = new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
        const completed = adherenceLog.filter(item => item.date === dateKey).length;
        const expected = medicines.filter(item => isScheduledOnDate(item, dateKey)).length;
        const percentage = expected ? Math.min(100, Math.round(completed / expected * 100)) : 0;
        rows.push({ label: date.toLocaleDateString(undefined, { weekday: "short" }), percentage });
    }
    container.innerHTML = rows.map((row, index) => `<div class="chart-row"><span>${row.label}</span><div class="bar"><div class="bar-fill" style="width:${row.percentage}%;--bar-delay:${index * 45}ms"></div></div><strong>${row.percentage}%</strong></div>`).join("");
}

function updateMissedList() {
    const container = document.getElementById("missedList");
    if (!container) return;
    const currentTime = new Date().toTimeString().slice(0, 5);
    const missed = medicines.filter(item => isScheduledOnDate(item, today()) && !item.taken && item.time < currentTime);
    container.innerHTML = missed.map(item => `<div class="medicine"><div><strong>${escapeHTML(item.name)}</strong><div class="medicine-info">${escapeHTML(item.dose)} · scheduled ${formatTime(item.time)}</div></div><button class="take" onclick="takeMedicine(${Number(item.id)})">Mark Taken</button></div>`).join("") || `<p class="taken">✓ No missed medicines detected.</p>`;
}

function updateProgress() {
    const todays = medicines.filter(item => isScheduledOnDate(item, today()));
    const total = todays.length;
    const taken = todays.filter(item => item.taken && item.takenDate === today()).length;
    const percentage = total ? Math.round(taken / total * 100) : 0;
    const circle = document.getElementById("progressCircle");
    const text = document.getElementById("progressText");
    if (circle) circle.textContent = `${percentage}%`;
    if (text) text.textContent = `${taken} of ${total} medicines marked taken today.`;
    updateWeeklyChart();
    updateMissedList();
    updateBloodPressureSummary();
}

function updateCaregiver() {
    const container = document.getElementById("caregiverStatus");
    const profileName = document.getElementById("patientName");
    const avatar = document.getElementById("patientAvatar");
    const patientNameInput = document.getElementById("patientNameInput");
    const nameInput = document.getElementById("caregiverName");
    const phoneInput = document.getElementById("caregiverPhone");
    if (profileName) profileName.textContent = activeProfile?.name || "Patient";
    if (avatar) avatar.textContent = (activeProfile?.name || "P").charAt(0).toUpperCase();
    if (patientNameInput && document.activeElement !== patientNameInput) patientNameInput.value = activeProfile?.name || "";
    if (nameInput && document.activeElement !== nameInput) nameInput.value = activeProfile?.caregiverName || "";
    if (phoneInput && document.activeElement !== phoneInput) phoneInput.value = activeProfile?.caregiverPhone || "";
    const todays = medicines.filter(item => isScheduledOnDate(item, today()));
    if (container) container.innerHTML = `<div class="medicine"><span>Scheduled today</span><strong>${todays.length}</strong></div><div class="medicine"><span>Taken today</span><strong class="taken">${todays.filter(item => item.taken && item.takenDate === today()).length}</strong></div><div class="medicine"><span>Pending</span><strong>${todays.filter(item => !item.taken || item.takenDate !== today()).length}</strong></div><div class="medicine"><span>Adherence</span><strong>${calculateAdherence()}%</strong></div>`;
}

function showReminder(message) {
    const box = document.getElementById("reminderBox");
    const text = document.getElementById("reminderText");
    if (!box || !text) return;
    text.textContent = message;
    box.classList.remove("hidden");
}

function closeReminder() {
    document.getElementById("reminderBox")?.classList.add("hidden");
}

function requestNotifications() {
    if (!("Notification" in window)) return alert("This browser does not support notifications.");
    Notification.requestPermission().then(permission => {
        if (permission === "granted") new Notification("Med Track Wise", { body: "Reminders can appear while this app is open." });
    });
}

function checkMedicationReminder() {
    if (!activeProfile) return;
    const now = new Date();
    const currentMinutes = now.getHours() * 60 + now.getMinutes();
    medicines.forEach(item => {
        if (!isScheduledOnDate(item, today()) || (item.taken && item.takenDate === today())) return;
        const [hours, minutes] = item.time.split(":").map(Number);
        const difference = currentMinutes - (hours * 60 + minutes);
        if (difference < 0 || difference > 30) return;
        const escalation = difference >= 5;
        const key = `${item.id}:${today()}:${escalation ? "caregiver" : "due"}`;
        if (activeProfile.alertsSent.includes(key)) return;
        activeProfile.alertsSent.push(key);
        const message = escalation
            ? `${activeProfile.name} has not marked ${item.name} (${item.dose}) taken, five minutes after its scheduled time.`
            : `Time for ${item.name}, ${item.dose}${item.instructions ? `, ${item.instructions}` : ""}.`;
        showReminder(message);
        if ("Notification" in window && Notification.permission === "granted") new Notification("Med Track Wise", { body: message });
        saveData();
    });
}

function saveCaregiver() {
    activeProfile.caregiverName = document.getElementById("caregiverName").value.trim();
    activeProfile.caregiverPhone = document.getElementById("caregiverPhone").value.trim();
    saveData();
    showReminder("Caregiver details saved for this patient.");
}

function shareCaregiverUpdate() {
    if (!activeProfile?.caregiverPhone) return alert("Add a caregiver phone number first.");
    const overdue = medicines.filter(item => isScheduledOnDate(item, today()) && !item.taken && item.time < new Date().toTimeString().slice(0, 5));
    const message = overdue.length
        ? `${activeProfile.name} may have missed: ${overdue.map(item => `${item.name} (${item.dose}) at ${formatTime(item.time)}`).join(", ")}. Please check in.`
        : `${activeProfile.name}'s medication update: no missed doses are listed.`;
    if (navigator.share) {
        navigator.share({ title: "Med Track Wise family update", text: message }).catch(() => {});
        return;
    }
    const phone = activeProfile.caregiverPhone.replace(/\D/g, "");
    const whatsapp = confirm("Open WhatsApp? Choose Cancel to prepare an SMS instead.");
    const destination = whatsapp
        ? `https://wa.me/${phone}?text=${encodeURIComponent(message)}`
        : `sms:${phone}?body=${encodeURIComponent(message)}`;
    window.open(destination, "_blank", "noopener");
}

function addMedicineReference() {
    const name = document.getElementById("guideMedicineName").value.trim();
    const notes = document.getElementById("guideMedicineNotes").value.trim();
    const file = document.getElementById("guideMedicinePhoto").files[0];
    if (!name || !file) return alert("Enter the name printed on the package and choose a photo.");
    compressImageFile(file).then(photo => {
        medicineReferences.unshift({ id: Date.now(), name, notes, photo, savedDate: today() });
        saveData();
        document.getElementById("guideMedicineName").value = "";
        document.getElementById("guideMedicineNotes").value = "";
        document.getElementById("guideMedicinePhoto").value = "";
        updateMedicineReferences();
    }).catch(() => alert("This photo could not be saved. Try a smaller image."));
}

function updateMedicineReferences() {
    const container = document.getElementById("medicineReferences");
    if (!container) return;
    container.innerHTML = medicineReferences.map(item => `<article class="reference-item"><img src="${item.photo}" alt="Package photo for ${escapeHTML(item.name)}"><div class="reference-content"><h2>${escapeHTML(item.name)}</h2><p>${escapeHTML(item.notes || "No notes added.")}</p><button class="secondary" onclick="speakReference(${Number(item.id)})">🔊 Read notes</button><button class="delete" onclick="deleteMedicineReference(${Number(item.id)})">Remove</button></div></article>`).join("") || `<div class="panel"><p>No medicine references saved for ${escapeHTML(activeProfile?.name || "this profile")}.</p></div>`;
}

function speakReference(id) {
    const item = medicineReferences.find(reference => reference.id === id);
    if (item) speakText(`${item.name}. ${item.notes || "No notes added."}`);
}

function deleteMedicineReference(id) {
    medicineReferences = medicineReferences.filter(item => item.id !== id);
    saveData();
    updateMedicineReferences();
}

function saveBloodPressure() {
    const systolic = Number(document.getElementById("bpSystolic").value);
    const diastolic = Number(document.getElementById("bpDiastolic").value);
    const date = document.getElementById("bpDate").value || today();
    const note = document.getElementById("bpNote").value.trim();
    if (!systolic || !diastolic || systolic < 50 || systolic > 260 || diastolic < 30 || diastolic > 160) return alert("Enter the systolic and diastolic values shown by your monitor.");
    healthReadings.push({ id: Date.now(), systolic, diastolic, date, note });
    healthReadings.sort((a, b) => a.date.localeCompare(b.date));
    saveData();
    document.getElementById("bpSystolic").value = "";
    document.getElementById("bpDiastolic").value = "";
    document.getElementById("bpNote").value = "";
    updateBloodPressureSummary();
}

function averageReadings(readings, key) {
    return readings.length ? Math.round(readings.reduce((sum, item) => sum + item[key], 0) / readings.length) : "No readings";
}

function dateKey(date) {
    return new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
}

function updateBloodPressureSummary() {
    const summary = document.getElementById("bpSummary");
    const history = document.getElementById("bpHistory");
    if (!summary || !history) return;
    const current = new Date(`${today()}T00:00:00`);
    const weekStart = new Date(current);
    weekStart.setDate(current.getDate() - 6);
    const previousWeekStart = new Date(weekStart);
    previousWeekStart.setDate(weekStart.getDate() - 7);
    const monthDate = new Date(current.getFullYear(), current.getMonth() - 1, 1);
    const week = healthReadings.filter(item => item.date >= dateKey(weekStart) && item.date <= today());
    const oldWeek = healthReadings.filter(item => item.date >= dateKey(previousWeekStart) && item.date < dateKey(weekStart));
    const month = today().slice(0, 7);
    const oldMonth = `${monthDate.getFullYear()}-${String(monthDate.getMonth() + 1).padStart(2, "0")}`;
    const thisMonth = healthReadings.filter(item => item.date.startsWith(month));
    const lastMonth = healthReadings.filter(item => item.date.startsWith(oldMonth));
    const showAverage = records => `${averageReadings(records, "systolic")} / ${averageReadings(records, "diastolic")}${records.length ? " mmHg" : ""} (${records.length} readings)`;
    summary.innerHTML = [["Last 7 days", week], ["Previous 7 days", oldWeek], ["This month", thisMonth], ["Previous month", lastMonth]].map(([label, records]) => `<div class="comparison-row"><strong>${label}</strong><span>${showAverage(records)}</span></div>`).join("");
    history.innerHTML = healthReadings.slice().reverse().slice(0, 10).map(item => `<div class="comparison-row"><span>${escapeHTML(item.date)}${item.note ? ` · ${escapeHTML(item.note)}` : ""}</span><strong>${item.systolic} / ${item.diastolic} mmHg</strong></div>`).join("") || `<p class="field-help">No readings recorded yet.</p>`;
}

function showReminder(message) {
    const box = document.getElementById("reminderBox");
    const text = document.getElementById("reminderText");
    if (!box || !text) return;
    text.textContent = message;
    box.classList.remove("hidden");
}

function closeReminder() {
    document.getElementById("reminderBox")?.classList.add("hidden");
}

function requestNotifications() {
    if (!("Notification" in window)) return alert("This browser does not support notifications.");
    Notification.requestPermission().then(permission => {
        if (permission === "granted") new Notification("Med Track Wise", { body: "Medication reminders can appear while the app is open." });
    });
}

function checkMedicationReminder() {
    if (!activeProfile) return;
    const now = new Date();
    const minute = now.getHours() * 60 + now.getMinutes();
    medicines.forEach(item => {
        if (!isScheduledOnDate(item, today()) || (item.taken && item.takenDate === today())) return;
        const [hours, minutes] = item.time.split(":").map(Number);
        const difference = minute - (hours * 60 + minutes);
        if (difference < 0 || difference > 30) return;
        const escalated = difference >= 5;
        const key = `${item.id}:${today()}:${escalated ? "caregiver" : "due"}`;
        if (activeProfile.alertsSent.includes(key)) return;
        activeProfile.alertsSent.push(key);
        const message = escalated
            ? `${activeProfile.name} has not marked ${item.name} (${item.dose}) taken, five minutes after its scheduled time.`
            : `Time for ${item.name}, ${item.dose}${item.instructions ? `, ${item.instructions}` : ""}.`;
        showReminder(message);
        if ("Notification" in window && Notification.permission === "granted") new Notification("Med Track Wise", { body: message });
        saveData();
    });
}

function handleAIKey(event) {
    if (event.key === "Enter") askAssistant();
}

function askAssistant() {
    const input = document.getElementById("aiInput");
    const question = input.value.trim();
    if (!question || !activeProfile) return;
    const profile = activeProfile;
    const answer = generateAssistantResponse(question);
    profile.conversation.push({ type: "user", text: question }, { type: "bot", text: answer });
    saveData();
    input.value = "";
    updateConversation();
}

function generateAssistantResponse(question) {
    const query = question.toLowerCase();
    if (query.includes("next") || query.includes("schedule") || query.includes("timetable")) {
        const upcoming = medicines.filter(item => isScheduledOnDate(item, today()) && (!item.taken || item.takenDate !== today())).sort((a, b) => a.time.localeCompare(b.time));
        if (!upcoming.length) return `All of ${activeProfile.name}'s scheduled medicines are marked taken today.`;
        const item = upcoming[0];
        return `The next listed medicine for ${activeProfile.name} is ${item.name}, ${item.dose}, at ${formatTime(item.time)}${item.instructions ? `. ${item.instructions}` : ""}. Follow the prescription label if anything differs.`;
    }
    if (query.includes("miss") || query.includes("pending")) {
        const pending = medicines.filter(item => !item.taken || item.takenDate !== today());
        return pending.length ? `Still to confirm: ${pending.map(item => `${item.name} at ${formatTime(item.time)}`).join(", ")}.` : "No pending doses are listed today.";
    }
    if (query.includes("stock") || query.includes("left") || query.includes("refill")) {
        const low = medicines.filter(item => Number.isFinite(item.stockCount));
        return low.length ? low.map(item => `${item.name}: ${item.stockCount} dose(s) left`).join(". ") : "No medicine stock counts have been entered yet.";
    }
    if (query.includes("blood pressure") || query.includes("bp")) {
        const latest = healthReadings.at(-1);
        return latest ? `The latest saved blood pressure reading is ${latest.systolic} over ${latest.diastolic}, recorded ${latest.date}. I cannot interpret or diagnose readings; discuss them with a healthcare professional.` : "No blood pressure readings are saved for this profile yet.";
    }
    if (query.includes("adherence") || query.includes("progress")) return `Today's recorded adherence is ${calculateAdherence()} percent for ${activeProfile.name}.`;
    if (query.includes("medicine") || query.includes("medication")) return `${activeProfile.name} has ${medicines.length} medicine(s) in the schedule. I can list the next dose, pending items, stock counts, or saved blood pressure readings.`;
    return "I can check this profile's schedule, pending doses, stock counts, and saved blood pressure readings. I cannot diagnose, recommend a medicine, or change a prescription. For urgent symptoms, contact local emergency services or a healthcare professional.";
}

function addChatMessage(message, type) {
    const container = document.getElementById("chatMessages");
    if (!container) return;
    const bubble = document.createElement("div");
    bubble.className = type === "user" ? "user-message" : "bot-message";
    const text = document.createElement("span");
    text.textContent = message;
    const speaker = document.createElement("button");
    speaker.type = "button";
    speaker.className = "message-speak";
    speaker.textContent = "🔊";
    speaker.title = "Read aloud";
    speaker.setAttribute("aria-label", "Read this message aloud");
    speaker.addEventListener("click", () => speakText(message));
    bubble.append(text, speaker);
    container.appendChild(bubble);
    container.scrollTop = container.scrollHeight;
}

function updateConversation() {
    const container = document.getElementById("chatMessages");
    if (!container) return;
    container.innerHTML = "";
    const conversation = activeProfile?.conversation || [];
    if (!conversation.length) {
        addChatMessage(`Hello ${activeProfile?.name || ""}. Ask me about the medicine timetable, pending doses, or stock.`, "bot");
        return;
    }
    conversation.slice(-100).forEach(message => addChatMessage(message.text, message.type));
}

function speakText(text) {
    if (!("speechSynthesis" in window)) return alert("Speech playback is not available in this browser.");
    window.speechSynthesis.cancel();
    window.speechSynthesis.speak(new SpeechSynthesisUtterance(text));
}

function speakConversation() {
    const messages = activeProfile?.conversation || [];
    speakText(messages.length ? messages.map(message => `${message.type === "user" ? activeProfile.name : "Assistant"} says: ${message.text}`).join(". ") : "No saved conversation yet.");
}

function startVoiceQuestion() {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) return alert("Voice input is unavailable in this browser. Use the text field; read-aloud controls remain available.");
    const recognition = new SpeechRecognition();
    recognition.lang = navigator.language || "en-US";
    recognition.interimResults = false;
    recognition.onresult = event => {
        document.getElementById("aiInput").value = event.results[0][0].transcript;
        askAssistant();
    };
    recognition.onerror = () => showReminder("Voice input was not available. Please type your question instead.");
    recognition.start();
}

function updateMedicineReferences() {
    const container = document.getElementById("medicineReferences");
    if (!container) return;
    container.innerHTML = medicineReferences.map(item => `<article class="reference-item"><img src="${item.photo}" alt="Package photo for ${escapeHTML(item.name)}"><div class="reference-content"><h2>${escapeHTML(item.name)}</h2><p>${escapeHTML(item.notes || "No notes added.")}</p><button class="secondary" onclick="speakReference(${Number(item.id)})">🔊 Read notes</button><button class="delete" onclick="deleteMedicineReference(${Number(item.id)})">Remove</button></div></article>`).join("") || `<div class="panel"><p>No medicine references saved for ${escapeHTML(activeProfile?.name || "this profile")}.</p></div>`;
}

function speakReference(id) {
    const item = medicineReferences.find(reference => reference.id === id);
    if (item) speakText(`${item.name}. ${item.notes || "No notes added."}`);
}

function deleteMedicineReference(id) {
    medicineReferences = medicineReferences.filter(item => item.id !== id);
    saveData();
    updateMedicineReferences();
}

function saveBloodPressure() {
    const systolic = Number(document.getElementById("bpSystolic").value);
    const diastolic = Number(document.getElementById("bpDiastolic").value);
    const date = document.getElementById("bpDate").value || today();
    const note = document.getElementById("bpNote").value.trim();
    if (!systolic || !diastolic || systolic < 50 || systolic > 260 || diastolic < 30 || diastolic > 160) return alert("Enter the systolic and diastolic values shown by your monitor.");
    healthReadings.push({ id: Date.now(), systolic, diastolic, date, note });
    healthReadings.sort((a, b) => a.date.localeCompare(b.date));
    saveData();
    document.getElementById("bpSystolic").value = "";
    document.getElementById("bpDiastolic").value = "";
    document.getElementById("bpNote").value = "";
    updateBloodPressureSummary();
}

function averageReadings(readings, key) {
    return readings.length ? Math.round(readings.reduce((sum, item) => sum + item[key], 0) / readings.length) : "No readings";
}

function dateKey(date) {
    return new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
}

function updateBloodPressureSummary() {
    const summary = document.getElementById("bpSummary");
    const history = document.getElementById("bpHistory");
    if (!summary || !history) return;
    const current = new Date(`${today()}T00:00:00`);
    const weekStart = new Date(current);
    weekStart.setDate(current.getDate() - 6);
    const previousStart = new Date(weekStart);
    previousStart.setDate(weekStart.getDate() - 7);
    const monthDate = new Date(current.getFullYear(), current.getMonth() - 1, 1);
    const week = healthReadings.filter(item => item.date >= dateKey(weekStart) && item.date <= today());
    const previousWeek = healthReadings.filter(item => item.date >= dateKey(previousStart) && item.date < dateKey(weekStart));
    const currentMonth = today().slice(0, 7);
    const oldMonth = `${monthDate.getFullYear()}-${String(monthDate.getMonth() + 1).padStart(2, "0")}`;
    const thisMonth = healthReadings.filter(item => item.date.startsWith(currentMonth));
    const lastMonth = healthReadings.filter(item => item.date.startsWith(oldMonth));
    const average = list => `${averageReadings(list, "systolic")} / ${averageReadings(list, "diastolic")}${list.length ? " mmHg" : ""} (${list.length} readings)`;
    summary.innerHTML = [["Last 7 days", week], ["Previous 7 days", previousWeek], ["This month", thisMonth], ["Previous month", lastMonth]].map(([label, list]) => `<div class="comparison-row"><strong>${label}</strong><span>${average(list)}</span></div>`).join("");
    history.innerHTML = healthReadings.slice().reverse().slice(0, 10).map(item => `<div class="comparison-row"><span>${escapeHTML(item.date)}${item.note ? ` · ${escapeHTML(item.note)}` : ""}</span><strong>${item.systolic} / ${item.diastolic} mmHg</strong></div>`).join("") || `<p class="field-help">No readings recorded yet.</p>`;
}

function toggleDarkMode() {
    document.body.classList.toggle("dark");
    localStorage.setItem("medTrackDark", String(document.body.classList.contains("dark")));
}

function updateAutomaticTheme() {
    const hour = new Date().getHours();
    document.body.classList.toggle("night-mode", hour >= 19 || hour < 6);
}

function exportData() {
    const blob = new Blob([JSON.stringify(activeProfile, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `med-track-wise-${activeProfile.name.replace(/[^a-z0-9-]/gi, "-")}.json`;
    link.click();
    URL.revokeObjectURL(url);
}

function renderAll() {
    if (!activeProfile) return;
    let resetDailyStatus = false;
    medicines.forEach(item => {
        if (item.taken && item.takenDate !== today()) {
            item.taken = false;
            resetDailyStatus = true;
        }
    });
    if (resetDailyStatus) saveData();
    updateDashboard();
    updateMedicineList();
    updateSchedule();
    updateProgress();
    updateCaregiver();
    updateMedicineReferences();
    updateConversation();
}

function setupImagePreview() {
    const input = document.getElementById("prescriptionPhoto");
    if (!input) return;
    input.addEventListener("change", async () => {
        const file = input.files[0];
        const preview = document.getElementById("prescriptionPreview");
        if (!file) return preview.classList.add("hidden");
        try {
            preview.src = await compressImageFile(file);
            preview.classList.remove("hidden");
        } catch {
            preview.classList.add("hidden");
        }
    });
}

async function initializeApp() {
    if (localStorage.getItem("medTrackDark") === "true") document.body.classList.add("dark");
    updateAutomaticTheme();
    setupImagePreview();
    document.getElementById("bpDate").value = today();
    let profile = familyProfiles[0];
    if (!profile) {
        profile = {
            id: crypto.randomUUID(),
            familyId: "local-family",
            name: "My profile",
            medicines: readJSON("medTrackMedicines", [])
        };
        familyProfiles.push(profile);
    }
    profile.familyId ||= "local-family";
    currentFamilyId = profile.familyId;
    try {
        localStorage.setItem(PROFILE_KEY, JSON.stringify(familyProfiles));
    } catch {
        showReminder("This device is low on storage. Export your data and remove some saved photos.");
    }
    activateProfile(profile);
    setInterval(() => {
        updateAutomaticTheme();
        checkMedicationReminder();
        updateHomeAlerts();
    }, 60000);
}

initializeApp();