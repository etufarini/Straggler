import { describe, expect, it } from 'vitest';
import {
  assertProjectWritable,
  moveConversationToProject,
  ownSystemPrompt,
  projectDescriptionError,
  projectNameError,
  removeConversationFromProject,
} from '../src/domain/projects';
import type { Project } from '../src/domain/projects';
import { newConversation } from '../src/domain/types';

function project(patch: Partial<Project> = {}): Project {
  return {
    id: 'project',
    name: 'Research',
    description: '',
    instructions: '',
    starred: false,
    archived: false,
    createdAt: 1,
    updatedAt: 1,
    files: [],
    ...patch,
  };
}

describe('project details', () => {
  it('requires a trimmed name and permits up to 80 Unicode characters', () => {
    expect(projectNameError('  ', [])).toBe('Enter a name for the project.');
    expect(projectNameError('  Research  ', [])).toBeUndefined();
    expect(projectNameError('😀'.repeat(80), [])).toBeUndefined();
    expect(projectNameError('😀'.repeat(81), [])).toBeDefined();
  });

  it('keeps names unique across active and archived projects, except the edited project', () => {
    const projects = [project(), project({ id: 'archived', name: 'Archive', archived: true })];
    expect(projectNameError(' research ', projects)).toContain('already exists');
    expect(projectNameError('ARCHIVE', projects)).toContain('already exists');
    expect(projectNameError('RESEARCH', projects, 'project')).toBeUndefined();
    expect(projectNameError('Another project', projects)).toBeUndefined();
  });

  it('allows an optional description with a 200-character boundary', () => {
    expect(projectDescriptionError('')).toBeUndefined();
    expect(projectDescriptionError('☕'.repeat(200))).toBeUndefined();
    expect(projectDescriptionError('☕'.repeat(201))).toBeDefined();
  });

  it('requires restoration before an archived project can be changed', () => {
    expect(() => assertProjectWritable(project())).not.toThrow();
    expect(() => assertProjectWritable(project({ archived: true }))).toThrow('Restore');
  });
});

describe('conversation membership and own prompt', () => {
  it.each([null, '', 'Own instructions'])(
    'preserves the legacy own prompt %j across moves',
    (prompt) => {
      const original = {
        ...newConversation(),
        options: { systemPrompt: prompt, reasoning: 'off' as const, effort: 'high' },
      };
      const moved = moveConversationToProject(original, project(), 2);
      const movedAgain = moveConversationToProject(moved, project({ id: 'second' }), 3);
      const removed = removeConversationFromProject(movedAgain, 4);

      expect(moved.projectId).toBe('project');
      expect(movedAgain.projectId).toBe('second');
      expect(removed.projectId).toBeNull();
      for (const value of [moved, movedAgain, removed]) {
        expect(ownSystemPrompt(value)).toBe(prompt);
        expect(value.options).toEqual(original.options);
        expect(value.messages).toEqual(original.messages);
      }
      expect(original.projectId).toBeUndefined();
      expect(original.ownSystemPrompt).toBeUndefined();
    },
  );

  it('defaults old records without request options to Settings inheritance', () => {
    const old = newConversation();
    expect(ownSystemPrompt(old)).toBeNull();
    expect(moveConversationToProject(old, project(), 2).ownSystemPrompt).toBeNull();
  });

  it('keeps an explicitly stored own prompt authoritative over the legacy field', () => {
    const chat = {
      ...newConversation(),
      ownSystemPrompt: null,
      options: { systemPrompt: 'Legacy prompt', reasoning: null, effort: null },
    };
    expect(ownSystemPrompt(chat)).toBeNull();
    expect(ownSystemPrompt({ ...chat, ownSystemPrompt: '' })).toBe('');
  });

  it('rejects moving a conversation into an archived project', () => {
    expect(() =>
      moveConversationToProject(newConversation(), project({ archived: true }), 2),
    ).toThrow('Restore');
  });
});
