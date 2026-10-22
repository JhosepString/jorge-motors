import { readFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
import { parse } from 'yaml';
const source = await readFile(new URL('../../.github/workflows/verify.yml', import.meta.url), 'utf8');
const workflow = parse(source, { uniqueKeys: true });
assert.deepEqual(Object.keys(workflow.on), ['workflow_dispatch']);
assert.deepEqual(workflow.permissions, { contents: 'read' });
assert.deepEqual(Object.keys(workflow.jobs).sort(), ['code', 'image']);
for (const job of Object.values(workflow.jobs)) {
  assert.ok(job['timeout-minutes'] > 0 && job['timeout-minutes'] <= 20);
  for (const step of job.steps) if (step.uses) assert.match(step.uses, /^[\w-]+\/[\w-]+@[a-f0-9]{40}$/);
  for (const step of job.steps)
    if (step.run?.includes('pnpm validate:workflow')) assert.equal(step['working-directory'], 'frontend');
}
assert.doesNotMatch(source, /azure\/login|docker push|az containerapp|id-token:\s*write/);
console.info('Workflow YAML válido: ejecución manual, acciones fijadas y sin publicación/despliegue.');
