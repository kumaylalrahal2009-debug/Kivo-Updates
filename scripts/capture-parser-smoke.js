const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');

const temp=fs.mkdtempSync(path.join(os.tmpdir(),'kivo-parser-ci-'));
process.env.KIVO_DATA_DIR=path.join(temp,'data');
process.env.KIVO_UPLOAD_DIR=path.join(temp,'uploads');
fs.mkdirSync(process.env.KIVO_DATA_DIR,{recursive:true});
fs.mkdirSync(process.env.KIVO_UPLOAD_DIR,{recursive:true});

const {understand,parseAmount,parseRecurrence}=require('../server.js');
const pass=x=>console.log(`✓ ${x}`);
const fail=(name,got,want)=>{throw new Error(`${name}: expected ${JSON.stringify(want)}, got ${JSON.stringify(got)}`)};
const eq=(name,got,want)=>{if(got!==want)fail(name,got,want);pass(name)};

try{
  let p=understand('gym membership 20 every month');
  eq('bare whole-number subscription amount',p.amount,20);
  eq('bare whole-number subscription category',p.category,'money');
  eq('bare whole-number subscription recurrence',p.recurrence,'monthly');

  p=understand('Spotify A$12 every month');
  eq('explicit currency amount',p.amount,12);
  eq('explicit currency category',p.category,'money');

  p=understand('gym membership remind me 2 days before');
  eq('reminder days are not mistaken for money',p.amount,null);

  p=understand('gym membership at 4pm');
  eq('clock hour is not mistaken for money',p.amount,null);

  p=understand('phone bill due in 3 days');
  eq('relative day count is not mistaken for bill amount',p.amount,null);

  p=understand('gym membership every 2 weeks 25');
  eq('recurrence interval is not mistaken for money',p.amount,25);
  eq('two-week recurrence remains fortnightly/weekly interval',p.recurrence==='fortnightly'||(p.recurrence==='weekly'&&Number(p.recurrence_interval)===2),true);

  p=understand('dentist appointment at 4:15pm');
  eq('appointment time is not money',p.amount,null);
  eq('appointment classification',p.category,'event');

  p=understand('return headphones by Friday');
  eq('deadline without money stays non-money',p.amount,null);
  eq('deadline classification',p.category,'deadline');

  p=understand('Netflix 9.99 every 11th remind me 1 day before');
  eq('decimal subscription remains money',p.amount,9.99);
  eq('monthly day remains 11',p.recurrence_day,11);
  eq('reminder remains one day',p.reminder_days,1);

  p=understand('rent 450 per week');
  eq('weekly whole-number cost',p.amount,450);
  eq('weekly recurring cost category',p.category,'money');

  p=understand('insurance annual 1200 renews September 2');
  eq('annual whole-number cost',p.amount,1200);
  eq('annual recurrence',p.recurrence,'yearly');

  console.log('\nKivo capture parser regression suite passed.');
}catch(err){
  console.error(`\nKIVO CAPTURE PARSER TEST FAILED: ${err.stack||err.message}`);
  process.exitCode=1;
}finally{
  try{fs.rmSync(temp,{recursive:true,force:true})}catch{}
}
