// Vowel marks affect a sense's reading, not the word's shared spelling.
// Hamza, madda and all letters remain significant.
export const stripTashkil = value => String(value ?? '').normalize('NFC').replace(/[\u064b-\u0652\u0670\u0640]/gu,'').trim().replace(/\s+/gu,' ');
export const hasTashkil = value => /[\u064b-\u0652\u0670]/u.test(value || '');
export const hasArabicLetter = value => [...String(value ?? '')].some(c => /\p{Script=Arabic}/u.test(c) && /\p{L}/u.test(c));
// Only explicit single-country varieties map to a flag. Regional/general
// Arabic remains regional/general; the publisher's location is irrelevant.
const locations = [
 ['EG',/egypt|cair|مصري|مصرى|قاهري|صعيدي/i],['TN',/tunis|تونسي/i],['PS',/palestin|فلسطيني/i],
 ['LB',/leban|لبناني/i],['IQ',/iraq|عراقي/i],['MA',/morocc|مغربي/i],['DZ',/algeri|جزائري/i],
 ['SD',/sudan|سوداني/i],['LY',/liby|ليبي/i],['SA',/saudi|hijazi|najdi|سعودي|حجازي|نجدي/i],
 ['YE',/yemen|hadhrami|sanʽani|taʽizzi|يمني|حضرمي/i],['SY',/syrian|damasc|سوري/i],
 ['JO',/jordan|أردني/i],['OM',/omani|dhofari|عماني/i],['KW',/kuwait|كويتي/i],
 ['AE',/emirati|إماراتي|اماراتي/i],['BH',/bahrain|بحريني/i],['QA',/qatari|قطري/i],
];
export function countryForDialect(dialect) {
 const value=stripTashkil(dialect),matches=locations.filter(([,pattern])=>pattern.test(value)).map(([code])=>code);
 return new Set(matches).size===1 ? matches[0] : null;
}
