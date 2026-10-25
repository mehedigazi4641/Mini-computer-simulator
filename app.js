/* PyVirtualSystem Ultimate — educational compiler, ALU, CPU, OS and debugger. */
'use strict';
(function (root) {
  const RAM_SIZE = 128, CODE_LIMIT = 96, DEFAULT_QUANTUM = 2, RUN_DELAY_MS = 250;
  const OPS = new Set(['SET','ADD','SUB','MUL','DIV','MOD','AND','OR','XOR','PRINT','OUT_PIN','LABEL','GOTO','IF','HALT','PUSH','POP']);
  const CMP = new Set(['>','<','>=','<=','==','!=']);
  const IDENT = /^[A-Za-z_][A-Za-z0-9_]*$/;
  const NUM = /^[-+]?(?:\d+\.?\d*|\.\d+)$/;
  const clone = x => JSON.parse(JSON.stringify(x));

  function tokenizeLine(text, line) {
    const parts = text.match(/>=|<=|==|!=|[-+]?(?:\d+\.?\d*|\.\d+)|[A-Za-z_][A-Za-z0-9_]*|\S/g) || [];
    return parts.map((value, i) => ({ line, type: i === 0 ? 'OPCODE' : NUM.test(value) ? 'NUMBER' : IDENT.test(value) ? 'IDENTIFIER' : 'SYMBOL', value }));
  }
  function parseProgram(source, optimize = true) {
    if (!String(source).trim()) throw new Error('Source code is empty.');
    const ast = [], tokens = [], labels = Object.create(null);
    String(source).split(/\r?\n/).forEach((raw, i) => {
      const line = i + 1, clean = raw.replace(/#.*$/, '').replace(/\/\/.*$/, '').trim();
      if (!clean) return;
      tokens.push(...tokenizeLine(clean, line));
      const p = clean.split(/\s+/), op = p[0].toUpperCase();
      if (!OPS.has(op)) throw new Error(`Line ${line}: unknown instruction "${p[0]}".`);
      const operand = x => NUM.test(x || '') || IDENT.test(x || '');
      let n;
      switch (op) {
        case 'LABEL':
          if (p.length !== 2 || !IDENT.test(p[1])) throw new Error(`Line ${line}: use LABEL name.`);
          if (Object.hasOwn(labels, p[1])) throw new Error(`Line ${line}: duplicate label "${p[1]}".`);
          labels[p[1]] = -1; n = { op, name: p[1], line }; break;
        case 'SET':
          if (p.length !== 4 || p[2] !== '=' || !IDENT.test(p[1]) || !operand(p[3])) throw new Error(`Line ${line}: use SET variable = number_or_variable.`);
          n = { op, target:p[1], value:p[3], line }; break;
        case 'ADD': case 'SUB': case 'MUL': case 'DIV': case 'MOD': case 'AND': case 'OR': case 'XOR':
          if (p.length !== 3 || !IDENT.test(p[1]) || !operand(p[2])) throw new Error(`Line ${line}: use ${op} variable number_or_variable.`);
          n = { op, target:p[1], value:p[2], line }; break;
        case 'PRINT': case 'OUT_PIN':
          if (p.length !== 2 || !operand(p[1])) throw new Error(`Line ${line}: use ${op} number_or_variable.`);
          n = { op, value:p[1], line }; break;
        case 'GOTO':
          if (p.length !== 2 || !IDENT.test(p[1])) throw new Error(`Line ${line}: use GOTO label.`);
          n = { op, label:p[1], line }; break;
        case 'IF':
          if (p.length !== 6 || !operand(p[1]) || !CMP.has(p[2]) || !operand(p[3]) || p[4].toUpperCase() !== 'GOTO' || !IDENT.test(p[5])) throw new Error(`Line ${line}: use IF left comparator right GOTO label.`);
          n = { op, left:p[1], comparator:p[2], right:p[3], label:p[5], line }; break;
        case 'PUSH':
          if (p.length !== 2 || !operand(p[1])) throw new Error(`Line ${line}: use PUSH number_or_variable.`);
          n = { op, value:p[1], line }; break;
        case 'POP':
          if (p.length !== 2 || !IDENT.test(p[1])) throw new Error(`Line ${line}: use POP variable.`);
          n = { op, target:p[1], line }; break;
        case 'HALT': if (p.length !== 1) throw new Error(`Line ${line}: HALT takes no operands.`); n = { op, line }; break;
      }
      ast.push(n);
    });
    // Optional constant folding for SET followed by arithmetic on the same variable.
    let nodes = ast.map(n => ({...n}));
    if (optimize) {
      const constants = Object.create(null), folded = [];
      for (const n of nodes) {
        if (n.op === 'LABEL' || n.op === 'GOTO' || n.op === 'IF') { folded.push(n); Object.keys(constants).forEach(k=>delete constants[k]); continue; }
        if (n.op === 'SET' && NUM.test(n.value)) { constants[n.target] = Number(n.value); folded.push({...n, value:String(Number(n.value))}); continue; }
        if (['ADD','SUB','MUL','DIV','MOD','AND','OR','XOR'].includes(n.op) && Object.hasOwn(constants,n.target) && (NUM.test(n.value) || Object.hasOwn(constants,n.value))) {
          const a=constants[n.target], b=NUM.test(n.value)?Number(n.value):constants[n.value];
          if ((n.op==='DIV'||n.op==='MOD') && b===0) { delete constants[n.target]; folded.push(n); continue; }
          const v = ({ADD:()=>a+b,SUB:()=>a-b,MUL:()=>a*b,DIV:()=>a/b,MOD:()=>a%b,AND:()=>((a|0)&(b|0)),OR:()=> (a|0)|(b|0),XOR:()=> (a|0)^(b|0)})[n.op]();
          if (Number.isFinite(v)) { constants[n.target]=v; folded.push({op:'SET',target:n.target,value:String(v),line:n.line,optimizedFrom:n.op}); continue; }
        }
        if (n.target) delete constants[n.target]; folded.push(n);
      }
      nodes=folded;
    }
    let pc=0;
    nodes.forEach(n => { if(n.op==='LABEL') labels[n.name]=pc; else pc++; });
    const bytecode = nodes.filter(n=>n.op!=='LABEL').map(n=>{
      if ((n.op==='GOTO'||n.op==='IF') && !Object.hasOwn(labels,n.label)) throw new Error(`Line ${n.line}: undefined label "${n.label}".`);
      if(n.op==='GOTO') return {op:'JUMP',target:labels[n.label],label:n.label,line:n.line};
      if(n.op==='IF') return {op:'JUMP_IF',left:n.left,comparator:n.comparator,right:n.right,target:labels[n.label],label:n.label,line:n.line};
      return {...n};
    });
    if(bytecode.length>CODE_LIMIT) throw new Error(`Program has ${bytecode.length} instructions; maximum is ${CODE_LIMIT}.`);
    const symbols = [...new Set(nodes.flatMap(n=>[n.target,n.value,n.left,n.right].filter(v=>v && IDENT.test(String(v)) && !OPS.has(String(v).toUpperCase()))))].sort();
    return {tokens, ast, optimizedAst:nodes, labels, bytecode, symbols};
  }
  function formatInstruction(i) {
    if(i.op==='JUMP') return `JUMP ${i.target} ; ${i.label}`;
    if(i.op==='JUMP_IF') return `JUMP_IF ${i.left} ${i.comparator} ${i.right} -> ${i.target}`;
    if(i.op==='SET') return `SET ${i.target} = ${i.value}`;
    if(i.target && i.value!==undefined) return `${i.op} ${i.target} ${i.value}`;
    if(i.target) return `${i.op} ${i.target}`;
    if(i.value!==undefined) return `${i.op} ${i.value}`;
    return i.op;
  }
  function createMachine() {
    return {processes:[],nextPid:101,currentPid:null,cycles:0,memory:Array(RAM_SIZE).fill(0),outputs:[],trace:[],history:[],breakpoints:new Set(),running:false,timer:null,quantumUsed:0,ledValue:0,flags:{Z:false,C:false,N:false,V:false},pageFrames:4,pageAlgorithm:'FIFO',pageQueue:[],pageFaults:0,pageHits:0};
  }
  function createProcess(machine, bytecode, priority=5, name) {
    if(machine.processes.length>=20) throw new Error('Process limit reached (20).');
    const pid=machine.nextPid++; const p={pid,name:name||`Program-${pid-100}`,priority:Number(priority)||5,state:'READY',code:clone(bytecode),pc:0,vars:{},stack:[],registers:{ACC:0,R1:0,R2:0,PC:0,SP:RAM_SIZE-1},flags:{Z:false,C:false,N:false,V:false},steps:0,cycles:0,output:[],remaining:bytecode.length,exitCode:null,error:null,createdOrder:machine.processes.length,baseAddress:0};
    machine.processes.push(p); if(machine.currentPid===null) machine.currentPid=p.pid; return p;
  }
  function valueOf(p, token) {
    if(NUM.test(String(token))) return Number(token);
    if(!Object.hasOwn(p.vars,token)) throw new Error(`Variable "${token}" used before SET.`);
    return p.vars[token];
  }
  function alu(p, op, a, b) {
    let result;
    switch(op){case'ADD':result=a+b;break;case'SUB':result=a-b;break;case'MUL':result=a*b;break;case'DIV':if(b===0)throw new Error('Division by zero.');result=a/b;break;case'MOD':if(b===0)throw new Error('Modulo by zero.');result=a%b;break;case'AND':result=(a|0)&(b|0);break;case'OR':result=(a|0)|(b|0);break;case'XOR':result=(a|0)^(b|0);break;default:throw new Error(`Unknown ALU operation ${op}.`);}
    if(!Number.isFinite(result)) throw new Error('Arithmetic result is not finite.');
    p.flags.Z=result===0; p.flags.N=result<0; p.flags.C=result>255||result<0; p.flags.V=result>2147483647||result< -2147483648;
    p.registers.ACC=result; p.registers.R1=a; p.registers.R2=b; return result;
  }
  function stepProcess(machine,p) {
    if(!p || !['READY','RUNNING'].includes(p.state)) return {ok:false,reason:'not-runnable'};
    if(p.pc>=p.code.length){p.state='TERMINATED';p.exitCode=0;return {ok:true,halted:true};}
    if(machine.breakpoints.has(p.pc)) return {ok:false,reason:'breakpoint',pc:p.pc};
    const pc=p.pc, ins=p.code[p.pc]; p.pc++; p.registers.PC=p.pc; p.steps++;p.cycles++;machine.cycles++;
    try {
      switch(ins.op){
        case'SET':p.vars[ins.target]=valueOf(p,ins.value);p.registers.ACC=p.vars[ins.target];break;
        case'ADD':case'SUB':case'MUL':case'DIV':case'MOD':case'AND':case'OR':case'XOR':{const a=valueOf(p,ins.target),b=valueOf(p,ins.value);p.vars[ins.target]=alu(p,ins.op,a,b);break;}
        case'PRINT':{const v=valueOf(p,ins.value);p.output.push(v);machine.outputs.push({pid:p.pid,value:v});break;}
        case'OUT_PIN':machine.ledValue=(Math.trunc(valueOf(p,ins.value))||0)&255;break;
        case'JUMP':p.pc=ins.target;break;
        case'JUMP_IF':{const a=valueOf(p,ins.left),b=valueOf(p,ins.right);p.registers.R1=a;p.registers.R2=b;const ok=({'>':a>b,'<':a<b,'>=':a>=b,'<=':a<=b,'==':a===b,'!=':a!==b})[ins.comparator];p.flags.Z=a===b;p.flags.N=a<b;if(ok)p.pc=ins.target;break;}
        case'PUSH':if(p.stack.length>=32)throw new Error('Stack overflow (maximum 32 values).');p.stack.push(valueOf(p,ins.value));p.registers.SP--;break;
        case'POP':if(!p.stack.length)throw new Error('Stack underflow.');p.vars[ins.target]=p.stack.pop();p.registers.SP++;p.registers.ACC=p.vars[ins.target];break;
        case'HALT':p.state='TERMINATED';p.exitCode=0;break;
        default:throw new Error(`Unknown VM instruction ${ins.op}.`);
      }
      p.registers.PC=p.pc;p.remaining=Math.max(0,p.code.length-p.steps);
      machine.trace.unshift({pid:p.pid,pc,text:formatInstruction(ins),line:ins.line,cycles:machine.cycles});machine.trace=machine.trace.slice(0,150);
      if(p.state!=='TERMINATED') p.state='RUNNING';
      return {ok:true,pc,instruction:ins,halted:p.state==='TERMINATED'};
    } catch(e){p.state='ERROR';p.error=`PC ${pc}, line ${ins.line}: ${e.message}`;p.exitCode=1;return {ok:false,reason:'runtime-error',error:p.error,pc};}
  }
  function chooseProcess(machine, algo='RR', quantum=DEFAULT_QUANTUM) {
    const ready=machine.processes.filter(p=>p.state==='READY'||p.state==='RUNNING'); if(!ready.length){machine.currentPid=null;return null;}
    let chosen;
    if(algo==='SJF') chosen=ready.slice().sort((a,b)=>a.remaining-b.remaining||a.createdOrder-b.createdOrder)[0];
    else if(algo==='PRIORITY') chosen=ready.slice().sort((a,b)=>a.priority-b.priority||a.createdOrder-b.createdOrder)[0];
    else if(algo==='FCFS') chosen=ready.slice().sort((a,b)=>a.createdOrder-b.createdOrder)[0];
    else {const cur=ready.findIndex(p=>p.pid===machine.currentPid);chosen=ready[(cur+1+ready.length)%ready.length]||ready[0];if(machine.quantumUsed<quantum&&ready.some(p=>p.pid!==machine.currentPid&&p.state==='READY')) chosen=ready.find(p=>p.pid===machine.currentPid)||chosen;}
    ready.forEach(p=>{if(p!==chosen&&p.state==='RUNNING')p.state='READY';});chosen.state='RUNNING';machine.currentPid=chosen.pid;machine.quantumUsed=0;return chosen;
  }
  function memoryPageAccess(machine, page) {
    page=Math.max(0,Math.floor(Number(page)||0)); const hit=machine.pageQueue.findIndex(x=>x.page===page);
    if(hit>=0){machine.pageHits++;const item=machine.pageQueue.splice(hit,1)[0];if(machine.pageAlgorithm==='LRU')machine.pageQueue.push(item);else machine.pageQueue.splice(hit,0,item);return {hit:true,page,frames:clone(machine.pageQueue),faults:machine.pageFaults,hits:machine.pageHits,evicted:null};}
    machine.pageFaults++;let evicted=null;if(machine.pageQueue.length>=machine.pageFrames)evicted=machine.pageQueue.shift().page;machine.pageQueue.push({page,loaded:machine.pageFaults});return {hit:false,page,frames:clone(machine.pageQueue),faults:machine.pageFaults,hits:machine.pageHits,evicted};
  }
  // DOM adapter is optional so all core features can be tested with Node.
  function bootUI() {
    const $=id=>document.getElementById(id); if(!$('sourceCode'))return;
    const ui={compiled:null, machine:createMachine(), watch:new Set(), opt:true, delay:RUN_DELAY_MS};
    const log=(s)=>{const el=$('terminalConsole');if(el){el.textContent+=`\n${s}`;el.scrollTop=el.scrollHeight;}};
    const esc=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
    const sample={factorial:'SET num = 5\nSET fact = 1\nLABEL loop\nMUL fact num\nSUB num 1\nIF num > 0 GOTO loop\nPRINT fact\nHALT',fibonacci:'SET a = 0\nSET b = 1\nSET count = 8\nLABEL loop\nPRINT a\nSET temp = a\nADD temp b\nSET a = b\nSET b = temp\nSUB count 1\nIF count > 0 GOTO loop\nHALT',arithmetic:'SET a = 12\nSET b = 4\nADD a b\nPRINT a\nSUB a 3\nPRINT a\nMUL a 2\nPRINT a\nDIV a b\nPRINT a\nHALT',branch:'SET x = 3\nLABEL loop\nPRINT x\nSUB x 1\nIF x > 0 GOTO loop\nPRINT 0\nHALT',alu:'SET a = 12\nSET b = 5\nADD a b\nPRINT a\nXOR a 3\nPRINT a\nHALT',stack:'SET x = 42\nPUSH x\nPOP y\nPRINT y\nHALT',led:'SET val = 1\nLABEL loop\nOUT_PIN val\nMUL val 2\nIF val > 128 GOTO done\nGOTO loop\nLABEL done\nHALT'};
    const update=()=>{
      const m=ui.machine,p=m.processes.find(x=>x.pid===m.currentPid)||null;
      const set=(id,v)=>{const e=$(id);if(e)e.textContent=v;};
      ['ACC','R1','R2','PC','SP'].forEach(k=>set('reg'+k,`0x${((Math.trunc(p?.registers[k]||0)&255).toString(16)).toUpperCase().padStart(2,'0')}`));
      ['Z','C','N','V'].forEach(k=>{const e=$('flag'+k);if(e)e.classList.toggle('active',!!p?.flags[k]);});
      set('cycleCount',m.cycles);set('processCount',m.processes.length);set('pageFaultCount',m.pageFaults);set('pageHitCount',m.pageHits);
      const out=$('outputConsole');if(out)out.textContent=m.outputs.map(x=>`PID-${x.pid}: ${x.value}`).join('\n')||'Program output will appear here.';
      const pcb=$('pcbContainer');if(pcb)pcb.innerHTML=m.processes.map(x=>`<div class="pcb-row ${x.pid===m.currentPid?'selected':''}"><div class="pcb-item"><span>PID / Name</span><b>${x.pid} · ${esc(x.name)}</b></div><div class="pcb-item"><span>State</span><b class="state-${x.state.toLowerCase()}">${x.state}</b></div><div class="pcb-item"><span>PC / Steps</span><b>${x.pc} / ${x.steps}</b></div><div class="pcb-item"><span>Priority / Remaining</span><b>${x.priority} / ${x.remaining}</b></div>${x.error?`<div class="error-text">${esc(x.error)}</div>`:''}<button class="btn btn-small btn-info select-process" data-pid="${x.pid}">Select process</button></div>`).join('')||'<p class="empty-msg">No processes. Compile a program and create a process.</p>';
      pcb?.querySelectorAll('[data-pid]').forEach(b=>b.addEventListener('click',()=>{const p2=m.processes.find(x=>x.pid===Number(b.dataset.pid));if(p2){if(m.currentPid&&m.processes.find(x=>x.pid===m.currentPid)?.state==='RUNNING')m.processes.find(x=>x.pid===m.currentPid).state='READY';m.currentPid=p2.pid;p2.state=p2.state==='READY'?'RUNNING':p2.state;update();}}));
      const grid=$('memoryGrid');if(grid){if(!grid.children.length){for(let i=0;i<RAM_SIZE;i++){const c=document.createElement('div');c.className='mem-cell';c.id='mem-'+i;grid.appendChild(c);}}for(let i=0;i<RAM_SIZE;i++){const c=$('mem-'+i);c.textContent=(m.memory[i]||0).toString(16).toUpperCase().padStart(2,'0');c.classList.toggle('current-pc',!!p&&i===p.pc);c.title=`RAM[${i}] = ${m.memory[i]||0}`;}}
      for(let i=0;i<8;i++)$('led-'+i)?.classList.toggle('on',!!((m.ledValue>>i)&1));
      const trace=$('executionTrace');if(trace)trace.innerHTML=m.trace.map(t=>`<div class="trace-row">C${t.cycles} · PID-${t.pid} · PC ${t.pc}: ${esc(t.text)}</div>`).join('')||'<p class="muted">Step or run to see execution trace.</p>';
      const vars=$('watchOutput');if(vars){const watched=p?Object.fromEntries([...ui.watch].filter(name=>Object.hasOwn(p.vars,name)).map(name=>[name,p.vars[name]])):{};vars.textContent=p?JSON.stringify({watchedVariables:watched,allVariables:p.vars,stack:p.stack},null,2):'Select a process to inspect variables.';}
      $('btnStep').disabled=!p||!['READY','RUNNING'].includes(p.state)||m.running;$('btnRun').disabled=!m.processes.some(x=>['READY','RUNNING'].includes(x.state));$('btnCreateProcess').disabled=!ui.compiled;
      const stats=$('schedulerStats');if(stats)stats.textContent=`Cycles: ${m.cycles} · Quantum: ${DEFAULT_QUANTUM} · Scheduler: ${$('schedulerAlgo')?.value||'RR'}`;
      const pg=$('pageFrames');if(pg)pg.innerHTML=m.pageQueue.map((x,i)=>`<span class="page-frame">Frame ${i}: Page ${x.page}</span>`).join('')||'<span class="muted">No pages loaded.</span>';
    };
    function renderCompile(result){$('tokenOutput').textContent=JSON.stringify(result.tokens,null,2);$('astOutput').textContent=JSON.stringify({sourceAST:result.ast,optimizedAST:result.optimizedAst,symbolTable:result.symbols,labels:result.labels},null,2);$('bytecodeOutput').textContent=result.bytecode.map((x,i)=>`[${String(i).padStart(3,'0')}] ${formatInstruction(x)}`).join('\n');}
    function stop(){ui.machine.running=false;if(ui.machine.timer)clearTimeout(ui.machine.timer);ui.machine.timer=null;const b=$('btnRun');if(b)b.textContent='Run';}
    function snapshot(){const m=ui.machine;return {processes:clone(m.processes),currentPid:m.currentPid,cycles:m.cycles,memory:clone(m.memory),outputs:clone(m.outputs),trace:clone(m.trace),quantumUsed:m.quantumUsed,ledValue:m.ledValue};}
    function doStep(fromRun=false){const m=ui.machine;if(m.running&&!fromRun)return;let p=m.processes.find(x=>x.pid===m.currentPid);if(!p||!['READY','RUNNING'].includes(p.state))p=chooseProcess(m,$('schedulerAlgo')?.value||'RR');if(!p){stop();update();return;}
      if(m.breakpoints.has(p.pc)){if(fromRun){stop();log(`Breakpoint hit at PC ${p.pc} (PID-${p.pid}).`);update();return;} m.breakpoints.delete(p.pc); }
      m.history.push(snapshot());if(m.history.length>100)m.history.shift();const res=stepProcess(m,p);
      if(res.reason==='breakpoint'){m.history.pop();stop();log(`Breakpoint hit at PC ${res.pc} (PID-${p.pid}).`);update();return;}
      if(res.reason==='runtime-error')log(`Runtime error: PID-${p.pid}: ${res.error}`);
      if(res.ok&&res.instruction)log(`[CPU] PID-${p.pid} PC ${res.pc}: ${formatInstruction(res.instruction)}`);
      const algo=$('schedulerAlgo')?.value||'RR';if(p.state==='TERMINATED'||p.state==='ERROR'){chooseProcess(m,algo);}else if(algo==='RR') {m.quantumUsed++;if(m.quantumUsed>=Number($('quantumInput')?.value||DEFAULT_QUANTUM)&&m.processes.some(x=>x.pid!==p.pid&&x.state==='READY'))chooseProcess(m,algo,Number($('quantumInput')?.value||DEFAULT_QUANTUM));}
      if(!m.processes.some(x=>['READY','RUNNING'].includes(x.state)))stop();update();
    }
    function runTick(){if(!ui.machine.running)return;doStep(true);if(ui.machine.running)ui.machine.timer=setTimeout(runTick,ui.delay);}
    $('sampleSelect')?.addEventListener('change',e=>{if(sample[e.target.value])$('sourceCode').value=sample[e.target.value];});
    $('btnCompile')?.addEventListener('click',()=>{stop();try{ui.compiled=parseProgram($('sourceCode').value, $('optimizeToggle')?.checked!==false);renderCompile(ui.compiled);log(`Compile successful: ${ui.compiled.ast.length} source statements, ${ui.compiled.bytecode.length} bytecode instructions, ${ui.compiled.symbols.length} symbols.`);$('compileStatus').textContent='Compile successful';$('compileStatus').className='status good';}catch(e){ui.compiled=null;$('compileStatus').textContent=e.message;$('compileStatus').className='status bad';$('bytecodeOutput').textContent=e.message;log(`Compile error: ${e.message}`);}update();});
    $('btnCreateProcess')?.addEventListener('click',()=>{if(!ui.compiled)return;try{const p=createProcess(ui.machine,ui.compiled.bytecode,$('priorityInput')?.value||5);log(`Created PID-${p.pid} (${p.code.length} instructions, priority ${p.priority}).`);p.code.forEach((ins,i)=>{if(i<CODE_LIMIT)ui.machine.memory[i]=({SET:1,ADD:2,SUB:3,MUL:4,DIV:5,MOD:6,AND:7,OR:8,XOR:9,PRINT:10,OUT_PIN:11,JUMP:12,JUMP_IF:13,PUSH:14,POP:15,HALT:255})[ins.op]||0;});update();}catch(e){log(e.message);}});
    $('btnStep')?.addEventListener('click',()=>doStep(false));
    $('btnRun')?.addEventListener('click',()=>{if(ui.machine.running){stop();return;}if(!ui.machine.processes.some(p=>['READY','RUNNING'].includes(p.state)))return;ui.machine.running=true;$('btnRun').textContent='Pause';runTick();});
    $('btnReset')?.addEventListener('click',()=>{stop();const fresh=createMachine();fresh.breakpoints=ui.machine.breakpoints;ui.machine=fresh;ui.compiled=null;ui.watch.clear();$('compileStatus').textContent='Not compiled';$('tokenOutput').textContent='Compile source to view tokens.';$('astOutput').textContent='AST and symbol table will appear here.';$('bytecodeOutput').textContent='Bytecode appears here.';log('System reset.');update();});
    $('btnAddBreakpoint')?.addEventListener('click',()=>{const n=Number($('breakpointInput').value);if(Number.isInteger(n)&&n>=0){ui.machine.breakpoints.add(n);$('breakpointList').textContent=[...ui.machine.breakpoints].sort((a,b)=>a-b).join(', ')||'none';log(`Breakpoint added at PC ${n}.`);}else log('Enter a non-negative integer PC.');});
    $('btnClearBreakpoints')?.addEventListener('click',()=>{ui.machine.breakpoints.clear();$('breakpointList').textContent='none';});
    $('btnReverse')?.addEventListener('click',()=>{const m=ui.machine,s=m.history.pop();if(!s){log('No previous state to restore.');return;}Object.assign(m,s);stop();log('Reverse-step restored the previous CPU/OS state.');update();});
    $('btnSaveProgram')?.addEventListener('click',()=>{const blob=new Blob([$('sourceCode').value],{type:'text/plain;charset=utf-8'}),url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download='program.pvs';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);});
    $('btnLoadProgram')?.addEventListener('click',()=>$('programFileInput')?.click());$('programFileInput')?.addEventListener('change',async e=>{const f=e.target.files?.[0];if(f){$('sourceCode').value=await f.text();log(`Loaded ${f.name}.`);e.target.value='';}});
    $('btnWatch')?.addEventListener('click',()=>{const name=$('watchInput').value.trim();if(IDENT.test(name)){ui.watch.add(name);$('watchList').textContent=[...ui.watch].join(', ')||'none';update();}});
    $('btnPageAccess')?.addEventListener('click',()=>{const r=memoryPageAccess(ui.machine,$('pageInput').value);log(`Page ${r.page}: ${r.hit?'HIT':'FAULT'}${r.evicted!==null?`, evicted ${r.evicted}`:''}.`);update();});
    $('pageAlgorithm')?.addEventListener('change',e=>{ui.machine.pageAlgorithm=e.target.value;});
    $('btnClearConsole')?.addEventListener('click',()=>{$('terminalConsole').textContent='Console cleared.';});
    document.querySelectorAll('.tab-btn').forEach(b=>b.addEventListener('click',()=>{document.querySelectorAll('.tab-btn').forEach(x=>x.classList.toggle('active',x===b));document.querySelectorAll('.tab-content').forEach(x=>x.classList.toggle('active',x.id===b.dataset.target));}));
    $('btnManual')?.addEventListener('click',()=>$('manualModal').style.display='flex');$('btnCloseModal')?.addEventListener('click',()=>$('manualModal').style.display='none');
    for(let i=0;i<8;i++){const el=document.createElement('div');el.className='led';el.id=`led-${i}`;el.title=`Bit ${i}`;$('ledBar')?.appendChild(el);}
    $('btnAddBreakpoint')?.setAttribute('title','Pause Run before executing the selected bytecode PC');
    update();log('PyVirtualSystem Ultimate ready. Compile a program to start.');
  }
  const API={RAM_SIZE,CODE_LIMIT,DEFAULT_QUANTUM,tokenizeLine,parseProgram,formatInstruction,createMachine,createProcess,valueOf,alu,stepProcess,chooseProcess,memoryPageAccess};
  root.PyVirtualSystem=API;
  if(typeof module!=='undefined' && module.exports) module.exports=API;
  if(typeof document!=='undefined')document.addEventListener('DOMContentLoaded',bootUI);
})(typeof window!=='undefined'?window:globalThis);
