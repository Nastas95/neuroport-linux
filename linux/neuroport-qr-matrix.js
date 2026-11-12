'use strict';
const qrcode = require(process.argv[2]);
const value = process.argv[3] || '';
if (!value) process.exit(2);
const qr = qrcode(0, 'M');
qr.addData(value);
qr.make();
const n = qr.getModuleCount();
const rows = [];
for (let y = 0; y < n; y++) {
  let row = '';
  for (let x = 0; x < n; x++) row += qr.isDark(y, x) ? '1' : '0';
  rows.push(row);
}
process.stdout.write(JSON.stringify(rows));
