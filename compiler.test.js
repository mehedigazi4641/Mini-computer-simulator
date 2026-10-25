// Regression suite. Run from this folder's parent: node tests/compiler.test.js
'use strict';
const assert = require('node:assert/strict');
const PVS = require('../app.js');
let passed = 0, failed = 0;
function test(name, fn) { try { fn(); passed++; console.log(`PASS ${name}`); } catch (e) { failed++; console.error(`FAIL ${name}\n  ${e.stack || e}`); } }
function rejects(fn, part) { let e; try { fn(); } catch (x) { e=x; } assert.ok(e, 'expected an error'); if(part) assert.ok(String(e.message).includes(part), `expected error containing ${part}, got ${e.message}`); }
function run(source, optimize=false, max=1000) {
  const compiled=PVS.parseProgram(source,optimize), m=PVS.createMachine(), p=PVS.createProcess(m,compiled.bytecode);
  let n=0; while(['READY','RUNNING'].includes(p.state)&&n++<max) PVS.stepProcess(m,p);
  assert.ok(n<max,'program did not terminate'); return {compiled,m,p};
}

test('two-pass labels use bytecode addresses',()=>{const p=PVS.parseProgram('SET x = 1\nGOTO done\nSET x = 99\nLABEL done\nPRINT x\nHALT',false);assert.equal(p.bytecode.length,5);assert.equal(p.labels.done,3);assert.equal(p.bytecode[1].target,3);});
test('factorial loop preserves control-flow semantics',()=>{const {p}=run('SET num = 5\nSET fact = 1\nLABEL loop\nMUL fact num\nSUB num 1\nIF num > 0 GOTO loop\nPRINT fact\nHALT',true);assert.deepEqual(p.output,[120]);assert.equal(p.state,'TERMINATED');});
test('all six conditional operators compile',()=>{for(const op of ['>','<','>=','<=','==','!='])PVS.parseProgram(`SET x = 1\nIF x ${op} 1 GOTO done\nLABEL done\nHALT`,false);});
test('comments, blank lines and case-insensitive opcodes',()=>{const p=PVS.parseProgram('# heading\nset x = 2 // inline\n\nPRINT x\nHALT',false);assert.equal(p.bytecode.length,3);});
test('rejects unknown instructions',()=>rejects(()=>PVS.parseProgram('WHAT x'), 'unknown instruction'));
test('rejects undefined labels',()=>rejects(()=>PVS.parseProgram('GOTO missing'), 'undefined label'));
test('rejects duplicate labels',()=>rejects(()=>PVS.parseProgram('LABEL again\nLABEL again'), 'duplicate label'));
test('rejects malformed conditional statements',()=>rejects(()=>PVS.parseProgram('IF x <> 1 GOTO end\nLABEL end\nHALT'), 'use IF'));
test('rejects malformed arithmetic statements',()=>rejects(()=>PVS.parseProgram('DIV x'), 'use DIV'));
test('rejects programs beyond code RAM limit',()=>rejects(()=>PVS.parseProgram(Array.from({length:97},()=> 'HALT').join('\n'),false),'maximum is 96'));
test('constant folding optimizes straight-line arithmetic',()=>{const p=PVS.parseProgram('SET a = 2\nSET b = 3\nADD a b\nPRINT a\nHALT',true);assert.ok(p.bytecode.some(i=>i.optimizedFrom==='ADD'));const m=PVS.createMachine(),pr=PVS.createProcess(m,p.bytecode);while(['READY','RUNNING'].includes(pr.state))PVS.stepProcess(m,pr);assert.deepEqual(pr.output,[5]);});
test('arithmetic ALU updates result and flags',()=>{const {p}=run('SET a = 255\nADD a 1\nPRINT a\nHALT',false);assert.equal(p.output[0],256);assert.equal(p.flags.C,true);});
test('bitwise ALU operations execute correctly',()=>{const {p}=run('SET a = 12\nAND a 10\nPRINT a\nOR a 1\nPRINT a\nXOR a 3\nPRINT a\nHALT',false);assert.deepEqual(p.output,[8,9,10]);});
test('division by zero transitions process to ERROR',()=>{const {p}=run('SET x = 8\nDIV x 0\nHALT',false);assert.equal(p.state,'ERROR');assert.match(p.error,/Division by zero/);});
test('use-before-SET reports runtime error',()=>{const {p}=run('PRINT unknown\nHALT',false);assert.equal(p.state,'ERROR');assert.match(p.error,/used before SET/);});
test('stack PUSH and POP preserve values',()=>{const {p}=run('SET x = 42\nPUSH x\nPOP y\nPRINT y\nHALT',false);assert.deepEqual(p.output,[42]);assert.equal(p.registers.SP,127);});
test('stack underflow is reported',()=>{const {p}=run('POP x\nHALT',false);assert.equal(p.state,'ERROR');assert.match(p.error,/Stack underflow/);});
test('FCFS scheduler dispatches oldest ready process',()=>{const m=PVS.createMachine(),bc=PVS.parseProgram('HALT',false).bytecode,a=PVS.createProcess(m,bc),b=PVS.createProcess(m,bc);m.currentPid=b.pid;assert.equal(PVS.chooseProcess(m,'FCFS').pid,a.pid);});
test('SJF scheduler dispatches shortest remaining job',()=>{const m=PVS.createMachine(),a=PVS.createProcess(m,PVS.parseProgram('SET x = 1\nHALT',false).bytecode),b=PVS.createProcess(m,PVS.parseProgram('HALT',false).bytecode);assert.equal(PVS.chooseProcess(m,'SJF').pid,b.pid);});
test('priority scheduler selects lower priority number',()=>{const m=PVS.createMachine(),a=PVS.createProcess(m,[{op:'HALT'}],8),b=PVS.createProcess(m,[{op:'HALT'}],2);assert.equal(PVS.chooseProcess(m,'PRIORITY').pid,b.pid);});
test('paging reports hits and FIFO evictions',()=>{const m=PVS.createMachine();[1,2,3,4].forEach(x=>PVS.memoryPageAccess(m,x));assert.equal(PVS.memoryPageAccess(m,1).hit,true);const r=PVS.memoryPageAccess(m,5);assert.equal(r.hit,false);assert.equal(r.evicted,1);assert.equal(m.pageFaults,5);assert.equal(m.pageHits,1);});
test('LRU moves a hit page to most-recent position',()=>{const m=PVS.createMachine();m.pageAlgorithm='LRU';[1,2,3,4].forEach(x=>PVS.memoryPageAccess(m,x));PVS.memoryPageAccess(m,1);const r=PVS.memoryPageAccess(m,5);assert.equal(r.evicted,2);});

test('built-in-style Fibonacci sample outputs eight terms',()=>{const {p}=run('SET a = 0\nSET b = 1\nSET count = 8\nLABEL loop\nPRINT a\nSET temp = a\nADD temp b\nSET a = b\nSET b = temp\nSUB count 1\nIF count > 0 GOTO loop\nHALT',true);assert.deepEqual(p.output,[0,1,1,2,3,5,8,13]);});
test('conditional branch sample produces expected countdown',()=>{const {p}=run('SET x = 3\nLABEL loop\nPRINT x\nSUB x 1\nIF x > 0 GOTO loop\nPRINT 0\nHALT',true);assert.deepEqual(p.output,[3,2,1,0]);});
test('digital output is constrained to eight bits',()=>{const m=PVS.createMachine(),bc=PVS.parseProgram('SET x = 257\nOUT_PIN x\nHALT',false).bytecode,p=PVS.createProcess(m,bc);while(['READY','RUNNING'].includes(p.state))PVS.stepProcess(m,p);assert.equal(m.ledValue,1);});
test('breakpoint set is available in machine state',()=>{const m=PVS.createMachine();m.breakpoints.add(2);assert.equal(m.breakpoints.has(2),true);m.breakpoints.clear();assert.equal(m.breakpoints.size,0);});
test('process limit is enforced',()=>{const m=PVS.createMachine(),bc=[{op:'HALT'}];for(let i=0;i<20;i++)PVS.createProcess(m,bc);rejects(()=>PVS.createProcess(m,bc),'Process limit');});
console.log(`\n${passed} passed, ${failed} failed (${passed+failed} total).`);
if(failed)process.exitCode=1;
