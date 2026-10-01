const fs = require('fs');
const path = require('path');
const assert = require('node:assert/strict');
const vm = require('vm');

const profile = {
  id: 'p1',
  familyId: 'f1',
  name: 'Test',
  medicines: [{
    id: 1,
    name: 'Aspirin',
    dose: '1 tablet',
    time: '08:00',
    frequency: 'Daily',
    instructions: '',
    stockCount: 10,
    unitsPerDose: 1,
    refillThreshold: 3,
    prescriptionImage: '',
    taken: false,
    takenDate: null,
    days: [0, 1, 2, 3, 4, 5, 6],
    startDate: '',
    endDate: ''
  }],
  healthReadings: [],
  medicineReferences: [],
  adherenceLog: [],
  alertsSent: [],
  conversation: []
};

function makeElement() {
  return {
    value: '',
    classList: { add() {}, remove() {}, toggle() {}, contains() { return false; } },
    textContent: '',
    innerHTML: '',
    checked: false,
    files: [],
    src: '',
    style: {},
    addEventListener() {}
  };
}

const elements = new Map([
  ['bpDate', makeElement()],
  ['profileSelect', makeElement()],
  ['patientNameInput', makeElement()],
  ['caregiverName', makeElement()],
  ['caregiverPhone', makeElement()],
  ['homeAlerts', makeElement()],
  ['dashboardMedicines', makeElement()],
  ['scheduleList', makeElement()],
  ['medicineList', makeElement()],
  ['missedList', makeElement()],
  ['caregiverStatus', makeElement()],
  ['progressCircle', makeElement()],
  ['progressText', makeElement()],
  ['greetingTitle', makeElement()],
  ['reminderBox', makeElement()],
  ['reminderText', makeElement()],
  ['patientName', makeElement()],
  ['patientAvatar', makeElement()],
  ['weeklyChart', makeElement()],
  ['bpSummary', makeElement()],
  ['bpHistory', makeElement()],
  ['medicineName', makeElement()],
  ['medicineDose', makeElement()],
  ['medicineTime', makeElement()],
  ['medicineInstructions', makeElement()],
  ['medicineStock', makeElement()],
  ['medicineUnitsPerDose', makeElement()],
  ['medicineStartDate', makeElement()],
  ['medicineEndDate', makeElement()],
  ['prescriptionPhoto', makeElement()],
  ['prescriptionPreview', makeElement()]
]);

const context = {
  console,
  localStorage: {
    getItem: (key) => {
      if (key === 'medTrackDark') return 'false';
      if (key === 'medTrackProfiles') return JSON.stringify([profile]);
      return '[]';
    },
    setItem() {},
    removeItem() {}
  },
  crypto: { randomUUID: () => 'x' },
  document: {
    querySelectorAll: () => [],
    getElementById: (id) => elements.get(id) || null,
    querySelector: () => ({ classList: { add() {}, remove() {} } }),
    body: { classList: { add() {}, remove() {}, toggle() {}, contains() { return false; } } }
  },
  alert: () => {},
  window: { prompt: () => '' },
  URL,
  Blob,
  Date,
  setInterval: () => 0
};

const code = fs.readFileSync(path.join(__dirname, 'backend', 'script.js'), 'utf8');
vm.createContext(context);
vm.runInContext(code, context);
context.takeMedicine(1);
const activeProfile = vm.runInContext('activeProfile', context);
assert.equal(activeProfile.medicines[0].taken, true);
assert.ok(activeProfile.medicines[0].takenDate);
assert.equal(activeProfile.adherenceLog.length, 1);
assert.match(elements.get('medicineList').innerHTML, /✓ Taken/);
console.log('Mark taken updates saved state and rendered status.');
