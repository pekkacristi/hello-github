// Inlines index.html + style.css + words.js + app.js into one self-contained page
// for publishing as a claude.ai artifact (which wraps the file in its own
// <!doctype>/<head>/<body> skeleton and blocks every external request).
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const read = f => fs.readFileSync(path.join(root, f), 'utf8');

const html = read('index.html');
const title = html.match(/<title>([\s\S]*?)<\/title>/)[1];
const body = html.match(/<body>([\s\S]*?)<\/body>/)[1]
  .replace(/<script src="[^"]*"><\/script>\s*/g, '');

const out = [
  `<title>${title}</title>`,
  `<style>\n${read('style.css')}\n</style>`,
  body.trim(),
  `<script>\n${read('words.js')}\n</script>`,
  `<script>\n${read('app.js')}\n</script>`,
].join('\n');

const dest = process.argv[2] || path.join(root, 'imposter-who.html');
fs.writeFileSync(dest, out);
console.log(`built ${dest} — ${(out.length / 1024).toFixed(0)} KB`);
