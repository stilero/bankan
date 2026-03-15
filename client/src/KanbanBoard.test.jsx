import { render, screen } from '@testing-library/react';
import { describe, expect, test, vi } from 'vitest';

vi.mock('./KanbanColumn.jsx', () => ({
  default: ({ column, tasks }) => (
    <div data-testid={`col-${column.id}`}>
      {tasks.map(t => <div key={t.id} data-testid={`task-${t.id}`}>{t.id}</div>)}
    </div>
  ),
}));

import KanbanBoard from './KanbanBoard.jsx';

describe('KanbanBoard sorting', () => {
  test('tasks with identical updatedAt maintain stable order by ID', () => {
    const now = new Date().toISOString();
    const tasks = [
      { id: 'T-GAMMA', title: 'Gamma', status: 'backlog', priority: 'medium', updatedAt: now },
      { id: 'T-ALPHA', title: 'Alpha', status: 'backlog', priority: 'medium', updatedAt: now },
      { id: 'T-BETA', title: 'Beta', status: 'backlog', priority: 'medium', updatedAt: now },
    ];

    render(
      <KanbanBoard
        tasks={tasks}
        agents={[]}
        onApprove={() => {}}
        onReject={() => {}}
        onAgentClick={() => {}}
        onAddTask={() => {}}
        onTaskClick={() => {}}
        canCreateTask={true}
      />
    );

    const backlogCol = screen.getByTestId('col-backlog');
    const taskIds = Array.from(backlogCol.querySelectorAll('[data-testid^="task-"]'))
      .map(el => el.textContent);

    // With identical timestamps, should be sorted by ID (localeCompare)
    expect(taskIds).toEqual(['T-ALPHA', 'T-BETA', 'T-GAMMA']);
  });
});
