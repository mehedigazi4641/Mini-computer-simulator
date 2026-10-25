# PyVirtualSystem Ultimate — Mini Computer System Simulator

A browser-only educational simulator combining a small programming language/compiler, virtual CPU/ALU, process scheduling, memory visualization, paging algorithms and debugger tools. It is a teaching model, not a real operating system or hardware emulator.

## Run

1. Keep `index.html`, `style.css`, and `app.js` in the same directory.
2. Open `index.html` in a modern browser. No build step or third-party JavaScript package is required.
3. Select a sample or enter code, click **Compile program**, then **Create process**.
4. Use **Step** for one instruction or **Run** to execute continuously.

## Language

```text
SET x = 5
ADD x 2
SUB x 1
MUL x 3
DIV x 2
MOD x 2
AND x 7
OR x 1
XOR x 3
PRINT x
OUT_PIN x
PUSH x
POP y
LABEL loop
IF x > 0 GOTO loop
GOTO loop
HALT
```

Comparators: `>`, `<`, `>=`, `<=`, `==`, `!=`. Comments begin with `#` or `//`. One instruction per line. Variables must be initialized with `SET` before use.

## Features

- Lexer/token list, parsed source AST, symbol table, two-pass label resolution and optional safe straight-line constant folding.
- Bytecode VM with ALU arithmetic and bitwise operations, ACC/R1/R2/PC/SP registers, Z/C/N/V flags, bounded stack, output and 8-bit digital port.
- Per-process PC, registers, variables and stack; PCB states; Round Robin, FCFS, SJF and non-preemptive priority scheduling.
- 128-cell illustrative RAM view, process priority, execution trace and program output.
- Bytecode-PC breakpoints, variable watch, reverse-step history, source save/load.
- Separate four-frame virtual paging lab with FIFO and LRU replacement.

## Automated tests

Requires Node.js 18+ (uses built-in `node:test`-free assertion helpers; no npm packages):

```bash
node tests/compiler.test.js
```

The suite checks compiler errors and labels, constant folding, loop execution, ALU results/flags, runtime errors, stack operations, scheduler choices, paging and process limits.

## Model limitations

- This is a simplified educational VM, not an x86/ARM/RISC-V instruction-set emulator.
- RAM values and opcode visualization are illustrative; each process has isolated variables and registers rather than true hardware memory protection.
- Priority scheduling is non-preemptive, SJF uses the simulator's estimated remaining instruction count, and paging is a separate demonstration from process execution.
- Reverse-step restores the core CPU/process/output/trace snapshot, not browser console text or paging-lab state.
- The virtual CPU uses JavaScript numbers; flags are simplified teaching flags, not a complete hardware flags register.
