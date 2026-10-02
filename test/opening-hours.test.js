// Tests for the opening-hours parser and helpers in osm.js.
global.navigator = { onLine: true };
global.window = global;
require('../osm.js');
var OSM = global.OSM;

var pass = 0;
var fail = 0;

function check(label, actual, expected) {
  var a = JSON.stringify(actual);
  var e = JSON.stringify(expected);
  if (a === e) {
    pass++;
  } else {
    fail++;
    console.log('FAIL ' + label + '\n  expected ' + e + '\n  actual   ' + a);
  }
}

// A fixed clock so results are repeatable. 2026-10-02 is a Friday.
function at(dayOffsetFromSunday, hh, mm) {
  // 2026-09-27 is a Sunday.
  return new Date(2026, 8, 27 + dayOffsetFromSunday, hh, mm, 0);
}
var SUN = 0, MON = 1, TUE = 2, WED = 3, THU = 4, FRI = 5, SAT = 6;

console.log('--- sanity: the clock helper lands on the right weekday');
check('sunday', at(SUN, 12, 0).getDay(), 0);
check('friday', at(FRI, 12, 0).getDay(), 5);

console.log('--- 24/7');
check('24/7 at 03:00', OSM.getOpenState('24/7', at(WED, 3, 0)).state, 'open');
check('24/7 label', OSM.getOpenState('24/7', at(WED, 3, 0)).label, 'Open now');

console.log('--- simple all-week range');
check('Mo-Su 07-19 at 08:00', OSM.getOpenState('Mo-Su 07:00-19:00', at(WED, 8, 0)).state, 'open');
check('Mo-Su 07-19 label', OSM.getOpenState('Mo-Su 07:00-19:00', at(WED, 8, 0)).label, 'Open until 19:00');
check('Mo-Su 07-19 at 06:00', OSM.getOpenState('Mo-Su 07:00-19:00', at(WED, 6, 0)).state, 'closed');
check('Mo-Su 07-19 at 06:00 label', OSM.getOpenState('Mo-Su 07:00-19:00', at(WED, 6, 0)).label, 'Closed · opens today at 07:00');
check('Mo-Su 07-19 at 20:00', OSM.getOpenState('Mo-Su 07:00-19:00', at(WED, 20, 0)).label, 'Closed · opens tomorrow at 07:00');
check('boundary: exactly 19:00 is closed', OSM.getOpenState('Mo-Su 07:00-19:00', at(WED, 19, 0)).state, 'closed');
check('boundary: exactly 07:00 is open', OSM.getOpenState('Mo-Su 07:00-19:00', at(WED, 7, 0)).state, 'open');

console.log('--- weekday/weekend split');
var split = 'Mo-Fr 07:30-19:00; Sa-Su 08:00-19:00';
check('Fri 07:45 open', OSM.getOpenState(split, at(FRI, 7, 45)).state, 'open');
check('Sat 07:45 closed', OSM.getOpenState(split, at(SAT, 7, 45)).state, 'closed');
check('Sat 08:30 open', OSM.getOpenState(split, at(SAT, 8, 30)).state, 'open');
check('Sun 09:00 open', OSM.getOpenState(split, at(SUN, 9, 0)).state, 'open');

console.log('--- comma day list');
var commas = 'Mo-Fr 07:30-19:00; Sa, Su 08:30-19:00';
check('Sun 09:00 open', OSM.getOpenState(commas, at(SUN, 9, 0)).state, 'open');
check('Sun 08:00 closed', OSM.getOpenState(commas, at(SUN, 8, 0)).state, 'closed');

console.log('--- explicit off day');
var withOff = 'Mo-Fr 07:00-16:00; Sa 08:00-15:00; Su off';
check('Sun always closed', OSM.getOpenState(withOff, at(SUN, 12, 0)).state, 'closed');
check('Sun next opening is Monday', OSM.getOpenState(withOff, at(SUN, 12, 0)).label, 'Closed · opens tomorrow at 07:00');
check('Sat 09:00 open', OSM.getOpenState(withOff, at(SAT, 9, 0)).state, 'open');

console.log('--- bare time range means every day');
check('bare range Tue 11:00 open', OSM.getOpenState('10:30-21:30', at(TUE, 11, 0)).state, 'open');
check('bare range Tue 22:00 closed', OSM.getOpenState('10:30-21:30', at(TUE, 22, 0)).state, 'closed');

console.log('--- 24:00 end');
check('ends at 24:00, 23:30 open', OSM.getOpenState('Mo-Fr 06:00-24:00; Sa-Su 07:00-24:00', at(THU, 23, 30)).state, 'open');
check('ends at 24:00 label is Open now', OSM.getOpenState('Mo-Fr 06:00-24:00', at(THU, 23, 30)).label, 'Open now');

console.log('--- crossing midnight');
// Open 22:00 Fri through 02:00 Sat.
check('Fri 23:00 open', OSM.getOpenState('Mo-Su 22:00-02:00', at(FRI, 23, 0)).state, 'open');
check('Sat 01:00 open', OSM.getOpenState('Mo-Su 22:00-02:00', at(SAT, 1, 0)).state, 'open');
check('Sat 03:00 closed', OSM.getOpenState('Mo-Su 22:00-02:00', at(SAT, 3, 0)).state, 'closed');

console.log('--- partial week (Tu-Su)');
check('Mon closed', OSM.getOpenState('Tu-Su 11:00-19:00', at(MON, 12, 0)).state, 'closed');
check('Mon opens tomorrow', OSM.getOpenState('Tu-Su 11:00-19:00', at(MON, 12, 0)).label, 'Closed · opens tomorrow at 11:00');
check('Tue open', OSM.getOpenState('Tu-Su 11:00-19:00', at(TUE, 12, 0)).state, 'open');

console.log('--- wrapping day range (Fr-Mo)');
check('Sat inside Fr-Mo', OSM.getOpenState('Fr-Mo 09:00-17:00', at(SAT, 12, 0)).state, 'open');
check('Wed outside Fr-Mo', OSM.getOpenState('Fr-Mo 09:00-17:00', at(WED, 12, 0)).state, 'closed');

console.log('--- split shift (two spans in one day)');
var shift = 'Mo-Fr 08:00-12:00,13:00-18:00';
check('11:00 open', OSM.getOpenState(shift, at(TUE, 11, 0)).state, 'open');
check('12:30 closed (lunch)', OSM.getOpenState(shift, at(TUE, 12, 30)).state, 'closed');
check('12:30 reopens today', OSM.getOpenState(shift, at(TUE, 12, 30)).label, 'Closed · opens today at 13:00');
check('14:00 open', OSM.getOpenState(shift, at(TUE, 14, 0)).state, 'open');

console.log('--- multi-day gap names the weekday');
check('Sat closed until Monday', OSM.getOpenState('Mo-Fr 09:00-17:00', at(SAT, 12, 0)).label, 'Closed · opens Monday at 09:00');

console.log('--- unknown / unparsable input falls back, never throws');
check('missing spec', OSM.getOpenState('', at(TUE, 12, 0)).state, 'unknown');
check('missing spec label', OSM.getOpenState('', at(TUE, 12, 0)).label, 'Hours not listed');
check('month range unparsed', OSM.getOpenState('Apr-Sep Mo-Su 09:00-18:00', at(TUE, 12, 0)).state, 'unknown');
check('short junk shown raw', OSM.getOpenState('by appointment', at(TUE, 12, 0)).label, 'by appointment');
check('long junk gets generic label', OSM.getOpenState('ring the bell and we will open whenever we feel like it', at(TUE, 12, 0)).label, 'See opening hours');
check('nth weekday unparsed', OSM.getOpenState('Mo[1] 09:00-17:00', at(TUE, 12, 0)).state, 'unknown');
check('PH-only rule is skipped, weekday rule still used', OSM.getOpenState('Mo-Fr 09:00-17:00; PH off', at(TUE, 12, 0)).state, 'open');

console.log('--- comma used as a rule separator (common in real data)');
var commaRules = 'Mo-Fr 08:00-19:00, Sa-Su 10:00-18:00';
check('Fri 09:00 open', OSM.getOpenState(commaRules, at(FRI, 9, 0)).state, 'open');
check('Sat 09:00 closed (weekend opens later)', OSM.getOpenState(commaRules, at(SAT, 9, 0)).state, 'closed');
check('Sat 11:00 open', OSM.getOpenState(commaRules, at(SAT, 11, 0)).state, 'open');
check('Sat 17:00 open (weekend runs to 18:00)', OSM.getOpenState(commaRules, at(SAT, 17, 0)).state, 'open');
var threeRules = 'Mo-Th 11:00-21:30, Fr-Sa 11:00-22:00, Su 11:00-21:30';
check('Fri 21:45 open', OSM.getOpenState(threeRules, at(FRI, 21, 45)).state, 'open');
check('Thu 21:45 closed', OSM.getOpenState(threeRules, at(THU, 21, 45)).state, 'closed');
check('Sun 21:00 open', OSM.getOpenState(threeRules, at(SUN, 21, 0)).state, 'open');
// The comma rule must not break day lists or split shifts.
check('day list still works', OSM.getOpenState('Mo-Fr 07:30-19:00; Sa, Su 08:30-19:00', at(SUN, 9, 0)).state, 'open');
check('split shift still works', OSM.getOpenState('Mo-Fr 08:00-12:00,13:00-18:00', at(TUE, 12, 30)).state, 'closed');

console.log('--- date-based holiday exceptions are skipped, weekly hours kept');
var holiday = 'Mo-Fr 07:00-19:00; Sa, Su 08:00-19:00; Nov Th[4] off; Dec 25 off';
check('weekday hours still parse', OSM.getOpenState(holiday, at(TUE, 9, 0)).state, 'open');
check('weekend hours still parse', OSM.getOpenState(holiday, at(SAT, 9, 0)).state, 'open');
check('before weekend opening', OSM.getOpenState(holiday, at(SAT, 7, 0)).state, 'closed');
check('seasonal-only entry still falls back', OSM.getOpenState('Apr-Sep Mo-Su 09:00-18:00', at(TUE, 12, 0)).state, 'unknown');
// "unknown" is not the same as "closed", so this must stay a raw fallback.
check('explicit unknown is not treated as closed', OSM.getOpenState('Mo-Fr 08:00-17:00; Sa-Su unknown', at(SAT, 12, 0)).state, 'unknown');

console.log('--- formatWeek');
var week = OSM.formatWeek('Mo-Fr 07:00-16:00; Sa 08:00-15:00; Su off');
check('starts on Monday', week[0], { day: 'Monday', hours: '07:00-16:00' });
check('ends on Sunday', week[6], { day: 'Sunday', hours: 'Closed' });
check('saturday', week[5], { day: 'Saturday', hours: '08:00-15:00' });
check('unparsable week returns null', OSM.formatWeek('whenever'), null);

console.log('--- distance');
var d = OSM.distanceMeters(40.7128, -74.006, 40.7228, -74.006);
check('1 degree-ish north about 1.11 km', Math.round(d / 10) * 10, 1110);
check('same point is zero', OSM.distanceMeters(40, -74, 40, -74), 0);
check('format metres', OSM.formatDistance(342), '340 m');
check('format km', OSM.formatDistance(1540), '1.5 km');
check('format long km', OSM.formatDistance(23400), '23 km');
check('format null', OSM.formatDistance(null), '');

console.log('--- url sanitising (XSS guard)');
check('blocks javascript:', OSM.sanitiseUrl('javascript:alert(1)'), '');
check('blocks data:', OSM.sanitiseUrl('data:text/html,<script>'), '');
check('allows https', OSM.sanitiseUrl('https://example.com/x'), 'https://example.com/x');
check('upgrades bare www', OSM.sanitiseUrl('www.example.com'), 'https://www.example.com/');
check('empty stays empty', OSM.sanitiseUrl(''), '');

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
