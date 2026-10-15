import { test, expect } from '@playwright/test';
import exact from '../fixtures/syllabus-exact.json' with { type: 'json' };

test.describe('realny lokalny Worker + D1 (bez mocków API)', () => {
  test('CRUD, podzadania, plan, eksport i trwałość danych', async ({ request }) => {
    const headers = { Origin: 'http://localhost:8899' };
    const marker = `QA-${Date.now()}`;
    const subjectResponse = await request.post('/api/subjects', {
      headers,
      data: { name: marker, color: '#8b8cf8' },
    });
    expect(subjectResponse.status()).toBe(201);
    const subject = (await subjectResponse.json()) as { id: string };
    const taskResponse = await request.post('/api/tasks', {
      headers,
      data: { title: `${marker} projekt`, subject_id: subject.id, due_date: '2026-11-20' },
    });
    expect(taskResponse.status()).toBe(201);
    const task = (await taskResponse.json()) as { id: string };
    const sub = await request.post(`/api/tasks/${task.id}/subtasks`, {
      headers,
      data: { title: 'Zebranie zrodel' },
    });
    expect(sub.status()).toBe(201);
    expect(
      (
        await request.patch(`/api/tasks/${task.id}`, { headers, data: { status: 'done' } })
      ).status(),
    ).toBe(200);
    const saved = await request.get(`/api/tasks/${task.id}`);
    expect(await saved.json()).toMatchObject({
      title: `${marker} projekt`,
      status: 'done',
      subject_id: subject.id,
    });
    const scheduleResponse = await request.post('/api/schedules', {
      headers,
      data: {
        subject_id: subject.id,
        weekday: 1,
        start_time: '10:00',
        end_time: '11:30',
        valid_from: '2026-10-01',
        valid_to: '2027-02-01',
        location: 'A1',
      },
    });
    expect(scheduleResponse.status()).toBe(201);
    const schedule = (await scheduleResponse.json()) as { id: string };
    const ics = await request.get('/api/export.ics');
    expect(ics.headers()['content-type']).toContain('text/calendar');
    expect(await ics.text()).toContain('RRULE:FREQ=WEEKLY');
    const exported = (await (await request.get('/api/export')).json()) as {
      tasks: Array<{ id: string }>;
    };
    expect(exported.tasks.some((item) => item.id === task.id)).toBe(true);
    expect((await request.delete(`/api/tasks/${task.id}`, { headers })).status()).toBe(200);
    expect((await request.get(`/api/tasks/${task.id}/subtasks`)).status()).toBe(404);
    expect((await request.delete(`/api/schedules/${schedule.id}`, { headers })).status()).toBe(200);
    expect((await request.delete(`/api/subjects/${subject.id}`, { headers })).status()).toBe(200);
  });

  test('CSRF, walidacja, obce relacje i nieistniejące rekordy', async ({ request }) => {
    expect(
      (
        await request.post('/api/tasks', {
          data: { title: 'CSRF attack' },
          headers: { Origin: 'https://evil.example' },
        })
      ).status(),
    ).toBe(403);
    expect((await request.post('/api/tasks', { data: { title: 'CSRF missing' } })).status()).toBe(
      403,
    );
    const headers = { Origin: 'http://localhost:8899' };
    expect(
      (
        await request.post('/api/tasks', {
          headers,
          data: { title: 'Bad', due_date: '2026-02-30' },
        })
      ).status(),
    ).toBe(400);
    expect(
      (
        await request.post('/api/tasks', {
          headers,
          data: { title: 'Bad', subject_id: 'other-users-record' },
        })
      ).status(),
    ).toBe(404);
    expect(
      (
        await request.post('/api/subjects', {
          headers,
          data: { name: 'Bad', user_id: 'other-user' },
        })
      ).status(),
    ).toBe(400);
    expect((await request.get('/api/tasks/nonexistent-qa-record')).status()).toBe(404);
  });

  test('import tekstu PDF odrzuca skany i deduplikuje ponowny dokument', async ({ request }) => {
    const headers = { Origin: 'http://localhost:8899' };
    const input = {
      name: exact.name,
      hash: 'e'.repeat(64),
      pages: exact.pages,
      subject_id: null,
      academic_year: exact.academic_year,
    };
    const scan = await request.post('/api/documents', {
      headers,
      data: { ...input, hash: 'f'.repeat(64), pages: [{ page: 1, text: '' }] },
    });
    expect(scan.status()).toBe(400);
    const response = await request.post('/api/documents', { headers, data: input });
    expect(response.ok()).toBe(true);
    const first = await response.json();
    const repeated = await request.post('/api/documents', { headers, data: input });
    expect(repeated.ok()).toBe(true);
    const second = await repeated.json();
    expect(second.document.id).toBe(first.document.id);
    expect(second.cached).toBe(true);
    await request.delete(`/api/documents/${first.document.id}`, { headers });
  });
});
