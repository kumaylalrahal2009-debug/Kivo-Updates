const assert = require('node:assert/strict');
const { understand } = require('./server.js');

let x = understand('monthly netflix 9.99 every 11th of the month');
assert.equal(x.title, 'Netflix');
assert.equal(x.category, 'money');
assert.equal(x.amount, 9.99);
assert.equal(x.recurrence, 'monthly');
assert.equal(x.recurrence_day, 11);
assert.equal(x.reminder_days, 1);

x = understand('Spotify 14 dollars on the 3rd each month');
assert.equal(x.title, 'Spotify');
assert.equal(x.amount, 14);
assert.equal(x.recurrence, 'monthly');
assert.equal(x.recurrence_day, 3);

x = understand('Disney+ $13.99 every 20th remind me 2 days before');
assert.equal(x.title, 'Disney+');
assert.equal(x.amount, 13.99);
assert.equal(x.reminder_days, 2);

x = understand('dentist tomorrow at 4:15pm');
assert.equal(x.title, 'Dentist');
assert.equal(x.category, 'event');
assert.equal(x.due_time, '16:15');

x = understand('return headphones by August 12');
assert.equal(x.title, 'Return Headphones');
assert.equal(x.category, 'deadline');
assert.equal(x.amount, null);

x = understand('Kayo 30 every Friday');
assert.equal(x.title, 'Kayo');
assert.equal(x.category, 'money');
assert.equal(x.amount, 30);
assert.equal(x.recurrence, 'weekly');
assert.equal(x.recurrence_weekday, 5);

console.log('Kivo smart engine tests passed.');
