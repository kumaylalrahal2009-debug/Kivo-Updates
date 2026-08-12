const weekdayMap={sun:0,sunday:0,mon:1,monday:1,tue:2,tues:2,tuesday:2,wed:3,wednesday:3,thu:4,thur:4,thurs:4,thursday:4,fri:5,friday:5,sat:6,saturday:6};

function moneyContext(text){
  return /\b(subscription|trial|monthly|weekly|fortnightly|fortnight|yearly|annually|annual|renewal|renew|charge|charged|payment|bill|fee|cost|pay|price|netflix|spotify|disney|prime|icloud|gym|membership|phone|internet|insurance|rent|kayo|binge|stan|youtube|apple|google|microsoft|adobe|canva|dropbox|hulu|paramount|crunchyroll)\b/i.test(String(text||''));
}

function isContextNumber(t,candidate){
  const {n,index,len}=candidate;
  const before=t.slice(Math.max(0,index-28),index);
  const after=t.slice(index+len,index+len+32);
  const immediateBefore=t.slice(Math.max(0,index-16),index);
  const immediateAfter=t.slice(index+len,index+len+20);

  if(/^(?:st|nd|rd|th)\b/.test(immediateAfter))return true;
  if(/^\s*%/.test(immediateAfter))return true;
  if(/^\s*(?:am|pm)\b/.test(immediateAfter))return true;
  if(/^\s*[:\/-]\s*\d/.test(immediateAfter)||/\d\s*[:\/-]\s*$/.test(immediateBefore))return true;
  if(n>=1900&&n<=2100)return true;

  if(/^\s*(?:days?|weeks?|months?|years?)\b/.test(immediateAfter)){
    if(/\b(?:remind|alert|notify)(?:\s+me)?\s*$/.test(immediateBefore))return true;
    if(/\b(?:in|within|after|before|for)\s*$/.test(immediateBefore))return true;
    if(/\b(?:remind|alert|notify)\b/.test(before)&&/\bbefore\b/.test(after))return true;
  }
  if(/\b(?:every|each)\s*$/.test(immediateBefore)&&/^\s*(?:days?|weeks?|months?|years?)\b/.test(immediateAfter))return true;
  if(/\bon\s+(?:the\s*)?$/.test(immediateBefore)&&n>=1&&n<=31)return true;
  if(/\bat\s*$/.test(immediateBefore)&&n>=0&&n<=24)return true;
  return false;
}

function parseAmount(text){
  const t=String(text||'').toLowerCase();
  let m=t.match(/(?:a\$|\$|aud\s*)(\d{1,6}(?:\.\d{1,2})?)/i);
  if(m)return Number(m[1]);
  m=t.match(/\b(\d{1,6}(?:\.\d{1,2})?)\s*(?:aud|dollars?|bucks?)\b/i);
  if(m)return Number(m[1]);
  if(!moneyContext(t))return null;

  const decimals=[...t.matchAll(/\b(\d{1,6}\.\d{1,2})\b/g)]
    .map(x=>({n:Number(x[1]),index:x.index||0,len:x[1].length}))
    .filter(x=>!isContextNumber(t,x));
  if(decimals.length)return decimals[0].n;

  const candidates=[...t.matchAll(/\b(\d{1,4})\b/g)]
    .map(x=>({n:Number(x[1]),index:x.index||0,len:x[1].length}))
    .filter(x=>x.n>0&&x.n<10000&&!isContextNumber(t,x));
  if(!candidates.length)return null;

  const cadence=candidates.find(x=>/^\s*(?:monthly|weekly|fortnightly|yearly|annually|annual|per\s+(?:day|week|fortnight|month|year)|a\s+(?:week|fortnight|month|year))\b/.test(t.slice(x.index+x.len,x.index+x.len+32)));
  if(cadence)return cadence.n;

  const priceAdjacent=candidates.find(x=>/\b(?:costs?|price|pay|payment|charge|charged|fee|rent|membership|subscription|bill)\s*(?:is|of|for)?\s*$/.test(t.slice(Math.max(0,x.index-32),x.index)));
  if(priceAdjacent)return priceAdjacent.n;
  return candidates[0].n;
}

function parseRecurrence(text){
  const t=String(text||'').toLowerCase().replace(/\s+/g,' ').trim();
  let recurrence=null,interval=1,day=null,weekday=null;

  if(/\b(?:daily|every day|each day|per day|once a day)\b/.test(t))recurrence='daily';
  else if(/\b(?:fortnightly|every fortnight|each fortnight|per fortnight|a fortnight|once a fortnight|every two weeks|biweekly)\b/.test(t))recurrence='fortnightly';
  else if(/\b(?:weekly|every week|each week|per week|a week|once a week)\b/.test(t))recurrence='weekly';
  else if(/\b(?:monthly|every month|each month|per month|a month|once a month)\b/.test(t))recurrence='monthly';
  else if(/\b(?:yearly|annually|annual|every year|each year|per year|a year|once a year)\b/.test(t))recurrence='yearly';

  const dayMatch=t.match(/\b(?:every|on|each)?\s*(?:the\s*)?(\d{1,2})(?:st|nd|rd|th)\b(?:\s+of\s+(?:the\s+)?month)?/);
  if(dayMatch&&Number(dayMatch[1])>=1&&Number(dayMatch[1])<=31&&(/month|monthly/.test(t)||/every\s+(?:the\s*)?\d{1,2}(?:st|nd|rd|th)/.test(t))){
    recurrence=recurrence||'monthly';day=Number(dayMatch[1]);
  }

  const weekdayMatch=t.match(/\b(?:every|each|on)\s+(sunday|monday|tuesday|wednesday|thursday|friday|saturday)\b/);
  if(weekdayMatch&&/\b(?:every|each)\b/.test(weekdayMatch[0])){recurrence='weekly';weekday=weekdayMap[weekdayMatch[1]];}

  const everyN=t.match(/\b(?:every|each)\s+(\d+)\s+(day|days|week|weeks|month|months|year|years)\b/);
  if(everyN){
    interval=Math.max(1,Number(everyN[1]));
    const unit=everyN[2];
    recurrence=unit.startsWith('day')?'daily':unit.startsWith('week')?'weekly':unit.startsWith('month')?'monthly':'yearly';
  }
  return{recurrence,recurrence_interval:interval,recurrence_day:day,recurrence_weekday:weekday};
}

module.exports={parseAmount,parseRecurrence,moneyContext,isContextNumber};
