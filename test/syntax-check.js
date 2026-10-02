/*
 * Build check. There is no bundler, so "building" means proving that every file
 * the browser loads is valid and that nothing references a file that is missing.
 * Run with: npm run check
 */
var fs = require('fs');
var path = require('path');
var vm = require('vm');

var root = path.join(__dirname, '..');
var problems = [];

function read(name) {
  return fs.readFileSync(path.join(root, name), 'utf8');
}

/* 1. Every script parses. */
['osm.js', 'shared.js', 'script.js', 'results.js'].forEach(function (file) {
  try {
    new vm.Script(read(file), { filename: file });
    console.log('ok    parses        ' + file);
  } catch (error) {
    problems.push(file + ' does not parse: ' + error.message);
  }
});

/* 2. No stray ES module or JSX syntax, which cannot run in a classic script.
      This is the exact fault that silently killed the old script.js. */
['osm.js', 'shared.js', 'script.js', 'results.js'].forEach(function (file) {
  var source = read(file);
  if (/^\s*import\s/m.test(source) || /^\s*export\s/m.test(source)) {
    problems.push(file + ' uses import/export but is loaded as a classic script');
  }
});

/* 3. Every local file referenced by the HTML actually exists. */
['index.html', 'results.html', '404.html'].forEach(function (page) {
  var html = read(page);
  var pattern = /(?:src|href)="([^"]+)"/g;
  var match;

  while ((match = pattern.exec(html)) !== null) {
    var ref = match[1];
    // Skip anything that is not a local file.
    if (/^(https?:|mailto:|tel:|data:|#|\/\/)/.test(ref)) continue;
    var target = ref.split('?')[0].split('#')[0];
    if (!target) continue;
    if (!fs.existsSync(path.join(root, target))) {
      problems.push(page + ' points at a missing file: ' + target);
    }
  }
  console.log('ok    references    ' + page);
});

/* 4. No leftover API keys. The old results.js shipped a Foursquare key. */
['osm.js', 'shared.js', 'script.js', 'results.js'].forEach(function (file) {
  var source = read(file);
  if (/fsq3[A-Za-z0-9+/=]{20,}/.test(source) || /api[_-]?key\s*[:=]\s*['"][^'"]{12,}/i.test(source)) {
    problems.push(file + ' looks like it contains a hard-coded API key');
  }
});
console.log('ok    no API keys committed');

/* 5. The CSS has balanced braces, a cheap guard against a truncated paste. */
var css = read('style.css');
var opens = (css.match(/{/g) || []).length;
var closes = (css.match(/}/g) || []).length;
if (opens !== closes) {
  problems.push('style.css has ' + opens + ' { and ' + closes + ' } - unbalanced');
} else {
  console.log('ok    css braces balanced (' + opens + ' rules)');
}

/* 6. Each id that the scripts look up exists in the page that loads them. */
function idsUsedIn(file) {
  var source = read(file);
  var ids = [];
  var pattern = /getElementById\(['"]([^'"]+)['"]\)/g;
  var match;
  while ((match = pattern.exec(source)) !== null) ids.push(match[1]);
  return ids;
}

function checkIds(scriptFile, pageFile) {
  var html = read(pageFile);
  var script = read(scriptFile);

  idsUsedIn(scriptFile).forEach(function (id) {
    var inPage = html.indexOf('id="' + id + '"') !== -1;
    // Some elements are built at runtime (empty states, retry buttons), so the
    // id legitimately comes from the script rather than the page. It may appear
    // as literal markup or be passed along as a string, as stateHtml() does.
    var builtByScript =
      script.indexOf('id="' + id + '"') !== -1 ||
      script.indexOf("'" + id + "'") !== -1;
    if (!inPage && !builtByScript) {
      problems.push(scriptFile + ' looks for #' + id + ', which exists in neither ' + pageFile + ' nor its own markup');
    }
  });
  console.log('ok    ids match      ' + scriptFile + ' -> ' + pageFile);
}

checkIds('script.js', 'index.html');
checkIds('results.js', 'results.html');

/* ------------------------------------------------------------------ report */

console.log('');
if (problems.length) {
  problems.forEach(function (problem) {
    console.log('FAIL  ' + problem);
  });
  console.log('\n' + problems.length + ' problem(s) found');
  process.exit(1);
}
console.log('All checks passed.');
