export async function run(context) {
  return {
    pdf: context.args.pdf,
    blocks: [...context.args.blocks],
    overlay: await context.collectOverlayState(),
    block: await context.collectBlockSnapshot('hook-block'),
    consoleCount: Array.isArray(context.consoleLines) ? context.consoleLines.length : -1,
  };
}
