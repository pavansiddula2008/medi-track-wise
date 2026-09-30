/* =====================================================
   MED TRACK WISE
   Main JavaScript
===================================================== */


/* ================= DATA ================= */

let medicines =
    JSON.parse(
        localStorage.getItem(
            "medTrackMedicines"
        )
    ) || [

        {
            id: 1,

            name: "Paracetamol",

            dose: "500 mg",

            time: "08:00",

            frequency: "Once daily",

            taken: true,

            takenDate: today()

        },

        {
            id: 2,

            name: "Amoxicillin",

            dose: "250 mg",

            time: "13:00",

            frequency: "Once daily",

            taken: false,

            takenDate: null

        },

        {
            id: 3,

            name: "Vitamin D3",

            dose: "1000 IU",

            time: "20:00",

            frequency: "Once daily",

            taken: false,

            takenDate: null

        }

    ];


/* ================= PAGE NAVIGATION ================= */

function showPage(page) {

    document
        .querySelectorAll(".page")
        .forEach(
            section =>
                section.classList.add("hidden")
        );


    const selected =
        document.getElementById(page);


    if (selected) {

        selected.classList.remove("hidden");

    }


    renderAll();

}


/* ================= DATE ================= */

function today() {

    return new Date()
        .toISOString()
        .split("T")[0];

}


/* ================= SAVE DATA ================= */

function saveData() {

    localStorage.setItem(
        "medTrackMedicines",
        JSON.stringify(medicines)
    );

}


/* ================= ADD MEDICINE ================= */

function addMedicine() {

    const name =
        document
            .getElementById(
                "medicineName"
            )
            .value
            .trim();


    const dose =
        document
            .getElementById(
                "medicineDose"
            )
            .value
            .trim();


    const time =
        document
            .getElementById(
                "medicineTime"
            )
            .value;


    const frequency =
        document
            .getElementById(
                "medicineFrequency"
            )
            .value;


    if (
        !name ||
        !dose ||
        !time
    ) {

        alert(
            "Please enter medicine name, dose and time."
        );

        return;

    }


    const medicine = {

        id:
            Date.now(),

        name,

        dose,

        time,

        frequency,

        taken:
            false,

        takenDate:
            null

    };


    medicines.push(
        medicine
    );


    saveData();


    document.getElementById(
        "medicineName"
    ).value = "";


    document.getElementById(
        "medicineDose"
    ).value = "";


    document.getElementById(
        "medicineTime"
    ).value = "";


    alert(
        `${name} added successfully!`
    );


    renderAll();

}


/* ================= DELETE MEDICINE ================= */

function deleteMedicine(id) {

    const medicine =
        medicines.find(
            item =>
                item.id === id
        );


    if (!medicine) return;


    const confirmed =
        confirm(
            `Delete ${medicine.name}?`
        );


    if (!confirmed) return;


    medicines =
        medicines.filter(
            item =>
                item.id !== id
        );


    saveData();

    renderAll();

}


/* ================= TAKE MEDICINE ================= */

function takeMedicine(id) {

    const medicine =
        medicines.find(
            item =>
                item.id === id
        );


    if (!medicine) return;


    medicine.taken =
        true;


    medicine.takenDate =
        today();


    saveData();


    renderAll();


    showReminder(
        `Great! ${medicine.name} has been recorded as taken.`
    );

}


/* ================= SEARCH ================= */

function getFilteredMedicines() {

    const searchElement =
        document.getElementById(
            "searchMedicine"
        );


    const search =
        searchElement
            ? searchElement.value
                .toLowerCase()
                .trim()
            : "";


    if (!search) {

        return medicines;

    }


    return medicines.filter(
        medicine =>
            medicine.name
                .toLowerCase()
                .includes(search)
    );

}


/* ================= DASHBOARD ================= */

function updateDashboard() {

    const total =
        medicines.length;


    const taken =
        medicines.filter(
            medicine =>
                medicine.taken
        ).length;


    const pending =
        total - taken;


    const percentage =
        total === 0

            ? 0

            : Math.round(
                (taken / total) *
                100
            );


    document.getElementById(
        "medicineCount"
    ).innerText =
        total;


    document.getElementById(
        "takenCount"
    ).innerText =
        taken;


    document.getElementById(
        "pendingCount"
    ).innerText =
        pending;


    document.getElementById(
        "adherence"
    ).innerText =
        percentage + "%";


    const container =
        document.getElementById(
            "dashboardMedicines"
        );


    if (!container) return;


    container.innerHTML = "";


    const filtered =
        getFilteredMedicines();


    if (
        filtered.length === 0
    ) {

        container.innerHTML =

            `<p class="empty">
                No medicines found.
            </p>`;

        return;

    }


    filtered.forEach(
        medicine => {

            container.innerHTML +=
                medicineHTML(
                    medicine
                );

        }
    );

}


/* ================= MEDICINE LIST ================= */

function updateMedicineList() {

    const container =
        document.getElementById(
            "medicineList"
        );


    if (!container) return;


    container.innerHTML = "";


    if (
        medicines.length === 0
    ) {

        container.innerHTML =
            `<p>No medicines added.</p>`;

        return;

    }


    medicines.forEach(
        medicine => {

            container.innerHTML +=
                medicineHTML(
                    medicine,
                    true
                );

        }
    );

}


/* ================= MEDICINE HTML ================= */

function medicineHTML(
    medicine,
    showDelete = false
) {

    const action =
        medicine.taken

            ?

            `<span class="taken">
                ✓ Taken
            </span>`

            :

            `<button
                class="take"
                onclick="takeMedicine(${medicine.id})">

                Mark Taken

            </button>`;


    const deleteButton =
        showDelete

            ?

            `<button
                class="delete"
                onclick="deleteMedicine(${medicine.id})">

                Delete

            </button>`

            : "";


    return `

        <div class="medicine">

            <div>

                <div class="medicine-name">

                    💊 ${medicine.name}

                </div>

                <div class="medicine-info">

                    ${medicine.dose}
                    •
                    ${formatTime(medicine.time)}
                    •
                    ${medicine.frequency}

                </div>

            </div>


            <div class="medicine-actions">

                ${action}

                ${deleteButton}

            </div>

        </div>

    `;

}


/* ================= TIME FORMAT ================= */

function formatTime(time) {

    if (!time) return "";


    const [
        hours,
        minutes
    ] =
        time.split(":");


    let hour =
        parseInt(hours);


    const period =
        hour >= 12
            ? "PM"
            : "AM";


    hour =
        hour % 12 || 12;


    return `${hour}:${minutes} ${period}`;

}


/* ================= SCHEDULE ================= */

function updateSchedule() {

    const container =
        document.getElementById(
            "scheduleList"
        );


    if (!container) return;


    container.innerHTML = "";


    const sorted =
        [...medicines].sort(
            (a, b) =>
                a.time.localeCompare(
                    b.time
                )
        );


    if (
        sorted.length === 0
    ) {

        container.innerHTML =
            `<p>No medicines scheduled.</p>`;

        return;

    }


    sorted.forEach(
        medicine => {

            container.innerHTML += `

                <div class="medicine">

                    <div>

                        <div class="medicine-name">

                            ⏰
                            ${formatTime(medicine.time)}

                        </div>

                        <div class="medicine-info">

                            ${medicine.name}
                            -
                            ${medicine.dose}

                        </div>

                    </div>


                    <div>

                        ${
                            medicine.taken

                            ?

                            `<span class="taken">
                                ✓ Completed
                            </span>`

                            :

                            `<span>
                                ⏳ Pending
                            </span>`

                        }

                    </div>

                </div>

            `;

        }
    );

}


/* ================= PROGRESS ================= */

function updateProgress() {

    const total =
        medicines.length;


    const taken =
        medicines.filter(
            medicine =>
                medicine.taken
        ).length;


    const percentage =
        total === 0

            ? 0

            : Math.round(
                taken / total * 100
            );


    const circle =
        document.getElementById(
            "progressCircle"
        );


    if (circle) {

        circle.innerText =
            percentage + "%";

    }


    const text =
        document.getElementById(
            "progressText"
        );


    if (text) {

        text.innerText =
            `${taken} of ${total} medicines completed today.`;

    }


    updateWeeklyChart();

    updateMissedList();

}


/* ================= WEEKLY CHART ================= */

function updateWeeklyChart() {

    const container =
        document.getElementById(
            "weeklyChart"
        );


    if (!container) return;


    const data = [

        ["Mon", 82],

        ["Tue", 76],

        ["Wed", 94],

        ["Thu", 88],

        ["Fri", 91],

        ["Sat", 79],

        [
            "Sun",
            calculateAdherence()
        ]

    ];


    container.innerHTML = "";


    data.forEach(
        item => {

            container.innerHTML += `

                <div class="chart-row">

                    <span>
                        ${item[0]}
                    </span>

                    <div class="bar">

                        <div
                            class="bar-fill"
                            style="
                                width:${item[1]}%
                            "
                        ></div>

                    </div>

                    <strong>
                        ${item[1]}%
                    </strong>

                </div>

            `;

        }
    );

}


/* ================= ADHERENCE ================= */

function calculateAdherence() {

    if (
        medicines.length === 0
    ) {

        return 0;

    }


    const taken =
        medicines.filter(
            medicine =>
                medicine.taken
        ).length;


    return Math.round(
        taken /
        medicines.length *
        100
    );

}


/* ================= MISSED MEDICINES ================= */

function updateMissedList() {

    const container =
        document.getElementById(
            "missedList"
        );


    if (!container) return;


    const now =
        new Date();


    const currentMinutes =
        now.getHours() * 60 +
        now.getMinutes();


    const missed =
        medicines.filter(
            medicine => {

                if (
                    medicine.taken
                ) {

                    return false;

                }


                const [
                    hours,
                    minutes
                ] =
                    medicine.time
                        .split(":")
                        .map(Number);


                const medicineMinutes =
                    hours * 60 +
                    minutes;


                return (
                    medicineMinutes <
                    currentMinutes
                );

            }
        );


    container.innerHTML = "";


    if (
        missed.length === 0
    ) {

        container.innerHTML =

            `<p class="taken">
                ✓ No missed medicines detected.
            </p>`;

        return;

    }


    missed.forEach(
        medicine => {

            container.innerHTML += `

                <div class="medicine">

                    <div>

                        <div class="medicine-name">

                            ⚠️
                            ${medicine.name}

                        </div>

                        <div class="medicine-info">

                            Scheduled:
                            ${formatTime(medicine.time)}

                        </div>

                    </div>

                    <span>
                        Missed
                    </span>

                </div>

            `;

        }
    );

}


/* ================= CAREGIVER ================= */

function updateCaregiver() {

    const container =
        document.getElementById(
            "caregiverStatus"
        );


    if (!container) return;


    const total =
        medicines.length;


    const taken =
        medicines.filter(
            medicine =>
                medicine.taken
        ).length;


    const pending =
        total - taken;


    const adherence =
        calculateAdherence();


    container.innerHTML = `

        <div class="medicine">

            <span>
                Medicines
            </span>

            <strong>
                ${total}
            </strong>

        </div>


        <div class="medicine">

            <span>
                Taken
            </span>

            <strong class="taken">
                ${taken}
            </strong>

        </div>


        <div class="medicine">

            <span>
                Pending
            </span>

            <strong>
                ${pending}
            </strong>

        </div>


        <div class="medicine">

            <span>
                Adherence
            </span>

            <strong>
                ${adherence}%
            </strong>

        </div>

    `;

}


/* ================= REMINDER ================= */

function showReminder(message) {

    const box =
        document.getElementById(
            "reminderBox"
        );


    const text =
        document.getElementById(
            "reminderText"
        );


    if (!box || !text) return;


    text.innerText =
        message;


    box.classList.remove(
        "hidden"
    );

}


function closeReminder() {

    document
        .getElementById(
            "reminderBox"
        )
        .classList.add(
            "hidden"
        );

}


/* ================= NOTIFICATIONS ================= */

function requestNotifications() {

    if (
        !("Notification" in window)
    ) {

        alert(
            "Your browser does not support notifications."
        );

        return;

    }


    Notification
        .requestPermission()
        .then(
            permission => {

                if (
                    permission ===
                    "granted"
                ) {

                    new Notification(
                        "Med Track Wise",
                        {
                            body:
                                "Medication reminders are enabled."
                        }
                    );

                }

            }
        );

}


/* ================= REMINDER CHECK ================= */

function checkMedicationReminder() {

    const now =
        new Date();


    const currentTime =
        now.toTimeString()
            .slice(0, 5);


    medicines.forEach(
        medicine => {

            if (
                medicine.taken
            ) return;


            if (
                medicine.time ===
                currentTime
            ) {

                showReminder(
                    `Time to take ${medicine.name} (${medicine.dose}).`
                );


                if (
                    "Notification"
                    in window &&
                    Notification.permission ===
                    "granted"
                ) {

                    new Notification(
                        "Medication Reminder",
                        {
                            body:
                                `Time to take ${medicine.name} - ${medicine.dose}`
                        }
                    );

                }

            }

        }
    );

}


/* ================= AI ASSISTANT ================= */

function handleAIKey(event) {

    if (
        event.key ===
        "Enter"
    ) {

        askAssistant();

    }

}


function askAssistant() {

    const input =
        document.getElementById(
            "aiInput"
        );


    const question =
        input.value.trim();


    if (!question) return;


    addChatMessage(
        question,
        "user"
    );


    input.value = "";


    setTimeout(
        () => {

            const answer =
                generateAssistantResponse(
                    question
                );


            addChatMessage(
                answer,
                "bot"
            );

        },
        400
    );

}


/*
    This is a LOCAL demo assistant.

    For a real AI assistant, connect this
    function to a secure backend/API instead
    of placing an API key in browser JavaScript.
*/

function generateAssistantResponse(
    question
) {

    const q =
        question.toLowerCase();


    if (
        q.includes("next") ||
        q.includes("upcoming")
    ) {

        if (
            medicines.length === 0
        ) {

            return "You don't have any medicines scheduled.";

        }


        const sorted =
            [...medicines].sort(
                (a, b) =>
                    a.time.localeCompare(
                        b.time
                    )
            );


        const next =
            sorted.find(
                medicine =>
                    !medicine.taken
            );


        if (!next) {

            return "All scheduled medicines are marked as taken today. Great job!";

        }


        return `Your next pending medicine is ${next.name}, ${next.dose}, scheduled for ${formatTime(next.time)}.`;

    }


    if (
        q.includes("adherence") ||
        q.includes("progress")
    ) {

        return `Your current medication adherence is ${calculateAdherence()}%. You have ${medicines.filter(m => !m.taken).length} pending medicine(s).`;

    }


    if (
        q.includes("miss") ||
        q.includes("missed")
    ) {

        const missed =
            medicines.filter(
                medicine =>
                    !medicine.taken
            );


        if (
            missed.length === 0
        ) {

            return "No pending medicines were found in today's list.";

        }


        return (
            "Your pending medicines are: " +
            missed
                .map(
                    medicine =>
                        `${medicine.name} at ${formatTime(medicine.time)}`
                )
                .join(", ") +
            "."
        );

    }


    if (
        q.includes("medicine") ||
        q.includes("medication")
    ) {

        return `You currently have ${medicines.length} medicine(s) in your schedule.`;

    }


    return `
        I can help you check your medication
        schedule and adherence.

        Try asking:

        • What is my next medicine?
        • What is my adherence?
        • Did I miss any medicine?
        • How many medicines do I have?
    `;

}


/* ================= CHAT UI ================= */

function addChatMessage(
    message,
    type
) {

    const container =
        document.getElementById(
            "chatMessages"
        );


    const div =
        document.createElement(
            "div"
        );


    div.className =
        type === "user"
            ? "user-message"
            : "bot-message";


    div.innerText =
        message;


    container.appendChild(
        div
    );


    container.scrollTop =
        container.scrollHeight;

}


/* ================= DARK MODE ================= */

function toggleDarkMode() {

    document.body.classList.toggle(
        "dark"
    );


    const dark =
        document.body.classList.contains(
            "dark"
        );


    localStorage.setItem(
        "medTrackDark",
        dark
    );

}


/* ================= EXPORT ================= */

function exportData() {

    const data =
        JSON.stringify(
            medicines,
            null,
            2
        );


    const blob =
        new Blob(
            [data],
            {
                type:
                    "application/json"
            }
        );


    const url =
        URL.createObjectURL(
            blob
        );


    const link =
        document.createElement(
            "a"
        );


    link.href =
        url;


    link.download =
        "med-track-wise-data.json";


    link.click();


    URL.revokeObjectURL(
        url
    );

}


/* ================= RENDER ALL ================= */

function renderAll() {

    updateDashboard();

    updateMedicineList();

    updateSchedule();

    updateProgress();

    updateCaregiver();

}


/* ================= START APPLICATION ================= */

if (
    localStorage.getItem(
        "medTrackDark"
    ) === "true"
) {

    document.body.classList.add(
        "dark"
    );

}


renderAll();


/*
    Check reminders every minute.
*/

setInterval(
    checkMedicationReminder,
    60000
);