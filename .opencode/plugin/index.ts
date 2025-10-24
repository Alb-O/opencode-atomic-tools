import writeAndCommitPlugin from './atomic-write.js';
import editAndCommitPlugin from './atomic-edit.js';

export default async function atomicToolsPlugin() {
  const writePlugin = await writeAndCommitPlugin();
  const editPlugin = await editAndCommitPlugin();

  return {
    tool: {
      ...writePlugin.tool,
      ...editPlugin.tool,
    },
  };
}
