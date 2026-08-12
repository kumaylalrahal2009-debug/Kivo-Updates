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

  // Reminder/relative timing numbers: "2 days before", "in 3 days".
  if(/^\s*(?:days?|weeks?|months?|years?)\b/.test(immediateAfter)){
    if(/\b(?:remind|alert|notify)(?:\s+me)?\s*$/.test(immediateBefore))return true;
    if(/\b(?:in|within|after|before|for)\s*$/.test(immediateBefore))return true;
    if(/\b(?:remind|alert|notify)\b/.test(before)&&/\bbefore\b/.test(after))return true;
  }

  // Recurrence interval: "every 2 weeks" / "each 3 months".
  if(/\b(?:every|each)\s*$/.test(immediateBefore)&&/^\s*(?:days?|weeks?|months?|years?)\b/.test(immediateAfter))return true;

  // Scheduling day: "on the 5" or "on 5" should not become a price.
  if(/\bon\s+(?:the\s*)?$/.test(immediateBefore)&&n>=1&&n<=31)return true;

  // Clock-like shorthand: "at 4" in a money-related sentence is usually time, not $4.
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

  // Prefer a number directly followed by a pricing cadence: "20 monthly", "12 per month".
  const cadence=candidates.find(x=>/^\s*(?:monthly|weekly|fortnightly|yearly|annually|annual|per\s+(?:day|week|fortnight|month|year)|a\s+(?:week|fortnight|month|year))\b/.test(t.slice(x.index+x.len,x.index+x.len+32)));
  if(cadence)return cadence.n;

  // Prefer a number immediately after strong price nouns/verbs.
  const priceAdjacent=candidates.find(x=>/\b(?:costs?|price|pay|payment|charge|charged|fee|rent|membership|subscription|bill)\s*(?:is|of|for)?\s*$/.test(t.slice(Math.max(0,x.index-32),x.index)));
  if(priceAdjacent)return priceAdjacent.n;

  // Context-only numbers have already been removed, so the first remaining number is the safest fallback.
  return candidates[0].n;
}

module.exports={parseAmount,moneyContext,isContextNumber};
