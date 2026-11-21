import { describe, expect, it } from 'vitest';
import {
  assembleProjectRequest,
  passageBudgets,
  resourceContextState,
  shrinkPassages,
} from '../src/domain/projectContext';
import { newConversation } from '../src/domain/types';
import type { ProjectPassage, Message } from '../src/domain/types';
import type { Project } from '../src/domain/projects';

const messages: Message[] = [
  { id: 'first', role: 'user', content: 'Old question', reasoning: '', status: 'complete' },
  { id: 'answer', role: 'assistant', content: 'Old answer', reasoning: '', status: 'complete' },
  { id: 'last', role: 'user', content: 'Current question', reasoning: '', status: 'complete' },
];
const project: Project = {
  id: 'project',
  name: 'Research',
  description: '',
  instructions: 'Keep full instructions',
  starred: false,
  archived: false,
  files: [],
  createdAt: 1,
  updatedAt: 1,
};
const attachment = {
  id: 'attachment',
  name: 'notes.txt',
  extension: 'txt',
  size: 100,
  text: 'Full attachment text',
};
const passage: ProjectPassage = {
  n: 1,
  conversationId: 'chat',
  fileId: 'attachment',
  name: 'notes.txt',
  section: 2,
  text: 'Relevant excerpt',
};

describe('attachment retrieval request boundaries', () => {
  it('keeps full files at 75% and switches strictly above, reserving the conversation', () => {
    const chat = {
      ...newConversation(),
      ownSystemPrompt: '',
      attachments: [{ ...attachment, text: 'x'.repeat(1000) }],
    };
    const used = resourceContextState(chat, undefined, undefined, 10000).used;
    expect(resourceContextState(chat, undefined, undefined, Math.ceil(used / 0.75)).search).toBe(
      false,
    );
    expect(
      resourceContextState(chat, undefined, undefined, Math.floor(used / 0.75) - 4).search,
    ).toBe(true);
    expect(resourceContextState(chat, undefined, undefined, null).search).toBe(false);
    expect(
      resourceContextState(
        { ...chat, ownSystemPrompt: 'x'.repeat(10000) },
        undefined,
        undefined,
        100,
      ).search,
    ).toBe(false);
  });

  it('splits a shared passage budget without ever exceeding it', () => {
    expect(passageBudgets(101, true, true)).toEqual({ project: 50, attachments: 51 });
    expect(passageBudgets(101, false, true)).toEqual({ project: 0, attachments: 101 });
    expect(passageBudgets(101, true, false)).toEqual({ project: 101, attachments: 0 });
    expect(passageBudgets(-1, true, true)).toEqual({ project: 0, attachments: 0 });
  });

  it('puts project and attachment excerpts only after the current user message and never mutates history', () => {
    const chat = {
      ...newConversation(),
      projectId: project.id,
      attachments: [attachment],
      messages,
    };
    const request = assembleProjectRequest(
      chat,
      messages,
      undefined,
      project,
      [{ ...passage, projectId: project.id, conversationId: undefined }],
      [passage],
    );
    expect(request[0]).toEqual({ role: 'system', content: project.instructions });
    expect(request[1].content).toBe('Old question');
    expect(request[2].content).toBe('Old answer');
    expect(request[3].content).toContain('Current question\n\n');
    expect(request[3].content).toContain('[P1] notes.txt · section 2');
    expect(request[3].content).toContain('[A1] notes.txt · section 2');
    expect(JSON.stringify(request)).not.toContain('Full attachment text');
    expect(messages.at(-1)?.content).toBe('Current question');
    expect(chat.attachments[0].text).toBe('Full attachment text');
    const full = assembleProjectRequest(chat, messages, undefined, project);
    expect(full[1].content).toContain('Full attachment text');
  });

  it('shrinks excerpts without splitting Unicode or retaining out-of-order sources', () => {
    expect(shrinkPassages([{ ...passage, text: '😀éab' }])[0].text).toBe('😀é');
    expect(shrinkPassages([passage, { ...passage, n: 2 }])).toEqual([passage]);
    expect(shrinkPassages([{ ...passage, text: 'x' }])).toEqual([]);
  });
});
