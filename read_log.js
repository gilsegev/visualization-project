const fs = require('fs');
const content = fs.readFileSync('test_failure_log.txt', 'utf16le');
const lines = content.split('\n');
const failures = lines.filter(l => l.includes('false') || l.includes('Asset mismatch') || l.includes('Image not found') || l.includes('Expected'));
console.log("FAILURES FOUND:");
console.log(failures.join('\n'));
