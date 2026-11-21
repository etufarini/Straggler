import { expect, test } from 'vitest';
import { newConversation } from '../src/domain/types';
import type { Conversation, Message } from '../src/domain/types';
import {
  compactionPlan,
  summaryAfterChange,
  summaryChunk,
  summaryRequest,
} from '../src/domain/compaction';
import { assembleProjectRequest } from '../src/domain/projectContext';
import { replaceMessage } from '../src/domain/messageActions';
import { serializeConversation } from '../src/domain/conversationExport';
import { approximateTokens } from '../src/domain/attachments';

function chat(): Conversation {
  return {
    ...newConversation(),
    messages: Array.from({ length: 8 }, (_, index): Message => ({
      id: String(index),
      role: index % 2 ? 'assistant' : 'user',
      content: `Turn ${index}: ` + 'あ'.repeat(100),
      reasoning: 'Excluded reasoning',
      status: 'complete',
    })),
  };
}
test('retains whole recent exchanges within the allowance and four messages when capacity is unknown', () => {
  const original = chat();
  const plan = compactionPlan(original, 800);
  expect(plan.keepFrom).toBe(6);
  expect(plan.throughMessageId).toBe('5');
  expect(plan.source).not.toContain('Excluded reasoning');
  expect(compactionPlan(original).keepFrom).toBe(4);
  expect(
    compactionPlan({ ...original, messages: original.messages.slice(0, 4) }, 8192).keepFrom,
  ).toBe(2);
  expect(original.messages).toHaveLength(8);
});
test('chunks are UTF-8 safe, preserve all source text and include the previous summary without its old turns', () => {
  const original = chat();
  original.summary = {
    throughMessageId: '1',
    text: 'Previous decisions',
    model: 'fixture',
    createdAt: 1,
  };
  const plan = compactionPlan(original);
  expect(plan.source).toContain('Previous decisions');
  expect(plan.source).not.toContain('Turn 0:');
  let rest = plan.source;
  let joined = '';
  while (rest) {
    const next = summaryChunk(rest, 60);
    expect(approximateTokens(next.chunk)).toBeLessThanOrEqual(60);
    joined += next.chunk;
    rest = next.rest;
  }
  expect(joined).toBe(plan.source);
  expect(summaryRequest('Summary', 'Source', false)).toHaveLength(1);
  expect(summaryRequest('Summary', 'Source', true)[0].role).toBe('system');
});
test('request-only summaries replace covered turns, follow the prefix or use the last user fallback, and exports retain originals', () => {
  const original = chat();
  original.ownSystemPrompt = 'Instructions';
  original.summary = {
    throughMessageId: '3',
    text: 'Earlier decisions',
    model: 'fixture',
    createdAt: 1,
  };
  const system = assembleProjectRequest(
    original,
    original.messages,
    undefined,
    undefined,
    undefined,
    undefined,
    false,
    true,
  );
  expect(system[0].content).toContain('Instructions\n\nEarlier chat summary');
  expect(system).toHaveLength(5);
  expect(
    system
      .slice(1)
      .map((turn) => turn.content)
      .join('\n'),
  ).not.toContain('Turn 0:');
  const fallback = assembleProjectRequest(original, original.messages);
  expect([...fallback].reverse().find((turn) => turn.role === 'user')?.content).toContain(
    'Earlier decisions',
  );
  const exported = JSON.parse(serializeConversation(original, false, new Date(0).toISOString()));
  expect(exported.version).toBe(1);
  expect(exported.conversation.summary).toBeUndefined();
  expect(exported.conversation.messages).toHaveLength(9);
  expect(original.messages).toHaveLength(8);
  const project = {
    id: 'project',
    name: 'Research',
    description: '',
    instructions: 'Project prefix',
    starred: false,
    archived: false,
    createdAt: 1,
    updatedAt: 1,
    files: [
      {
        id: 'file',
        name: 'notes.txt',
        extension: 'txt',
        size: 5,
        text: 'Full file',
        included: true,
      },
    ],
  };
  const member = { ...original, projectId: project.id };
  const projectRequest = assembleProjectRequest(
    member,
    member.messages,
    undefined,
    project,
    undefined,
    undefined,
    false,
    true,
  );
  expect(projectRequest[0].content).toContain('Project prefix');
  expect(projectRequest[0].content).toContain('Full file');
  expect(projectRequest[0].content).toContain('Earlier decisions');
  const onlyCovered = {
    ...original,
    summary: { ...original.summary!, throughMessageId: original.messages.at(-1)!.id },
  };
  expect(
    assembleProjectRequest(onlyCovered, onlyCovered.messages)
      .map((turn) => turn.content)
      .join('\n'),
  ).toContain('Earlier decisions');
});
test('editing or regenerating covered history removes its summary but later changes retain it', () => {
  const original = chat();
  original.summary = { throughMessageId: '3', text: 'Summary', model: 'fixture', createdAt: 1 };
  expect(summaryAfterChange(original, '2')).toBeUndefined();
  expect(replaceMessage(original, '1', 'Changed answer', 2).summary).toBeUndefined();
  expect(summaryAfterChange(original, '6')).toEqual(original.summary);
});
