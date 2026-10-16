import { expect, test } from '@playwright/test';
import { fileURLToPath } from 'node:url';

const fixture = (name: string) => fileURLToPath(new URL(`../fixtures/${name}`, import.meta.url));

test.describe('StudentOS — prawdziwy interfejs i lokalne dane', () => {
  test('wgrany plan GL2 zachowuje godziny i ograniczenia tygodni po odświeżeniu', async ({
    page,
  }) => {
    await page.goto('/#calendar');
    const plan = page.getByRole('region', { name: 'Wgrany plan semestru' });
    await expect(plan).toBeVisible();
    await expect(plan.getByText('GI1 / GL2', { exact: true })).toBeVisible();
    await expect(plan.getByText('17:00–19:45 · GL2', { exact: true })).toBeVisible();
    await expect(plan.getByText('10 spotkań, od 10.11.2026', { exact: true })).toBeVisible();
    await expect(plan.getByText('GL1', { exact: true })).toHaveCount(0);
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1),
    ).toBe(true);
    await page.reload();
    await expect(plan.getByText('GI1 / GL2', { exact: true })).toBeVisible();
  });
  test.afterEach(async ({ request }) => {
    const response = await request.get('/api/bootstrap');
    if (!response.ok()) return;
    const data = await response.json();
    const marker = /^UI-(?:android|desktop)-chromium-\d+/;
    const headers = { Origin: 'http://localhost:8899' };
    for (const task of data.tasks.filter((item: { title: string }) => marker.test(item.title)))
      await request.delete(`/api/tasks/${task.id}`, { headers });
    for (const subject of data.subjects.filter((item: { name: string }) => marker.test(item.name)))
      await request.delete(`/api/subjects/${subject.id}`, { headers });
  });
  test('przedmiot, plan zajęć, szybkie zadanie i ukończenie po odświeżeniu', async ({
    page,
    request,
  }, testInfo) => {
    const marker = `UI-${testInfo.project.name}-${Date.now()}`;
    const headers = { Origin: 'http://localhost:8899' };
    await page.goto('/#subjects');
    await expect(page.getByRole('heading', { name: 'Przedmioty', exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Nowy przedmiot', exact: true }).click();
    await page.getByLabel('Nazwa przedmiotu').fill(marker);
    await page.getByLabel('Prowadzący').fill('Prowadzący testowy');
    await page.getByRole('button', { name: 'Zapisz przedmiot', exact: true }).click();
    await expect(page.getByRole('heading', { name: marker, exact: true })).toBeVisible();
    let bootstrap = await (await request.get('/api/bootstrap')).json();
    const subject = bootstrap.subjects.find((item: { name: string }) => item.name === marker);
    expect(subject).toBeTruthy();
    await page.goto('/#calendar');
    await page.getByRole('button', { name: 'Plan zajęć', exact: true }).click();
    await page.getByRole('combobox', { name: 'Przedmiot', exact: true }).selectOption(subject.id);
    await page.getByRole('combobox', { name: 'Dzień tygodnia', exact: true }).selectOption('1');
    await page.getByLabel('Początek', { exact: true }).fill('10:00');
    await page.getByLabel('Koniec', { exact: true }).fill('11:30');
    await page.getByLabel('Obowiązuje od').fill('2026-10-01');
    await page.getByLabel('Obowiązuje do').fill('2027-02-01');
    await page.getByLabel('Sala / miejsce').fill('Sala QA');
    await page.getByRole('button', { name: 'Zapisz plan zajęć', exact: true }).click();
    await expect(
      page.getByRole('heading', { name: 'Powtarzalne zajęcia', exact: true }),
    ).toHaveCount(0);
    await page.reload();
    await expect(page.getByRole('heading', { name: 'Kalendarz', exact: true })).toBeVisible();
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1),
    ).toBe(true);
    await page.getByRole('button', { name: 'Nowe zadanie', exact: true }).first().click();
    const dialog = page.getByRole('dialog');
    await dialog.getByLabel('Co chcesz zrobić?').fill(`${marker} projekt`);
    await dialog.getByRole('combobox', { name: 'Przedmiot', exact: true }).selectOption(subject.id);
    await dialog.getByLabel('Termin', { exact: true }).fill('2026-11-20');
    await dialog.getByRole('combobox', { name: 'Priorytet', exact: true }).selectOption('high');
    await dialog.getByRole('button', { name: 'Zapisz zadanie', exact: true }).click();
    await expect(dialog).toHaveCount(0);
    const nav = testInfo.project.name.startsWith('android')
      ? page.getByRole('navigation', { name: 'Nawigacja mobilna' })
      : page.getByRole('navigation', { name: 'Nawigacja główna' });
    await nav.getByRole('button', { name: /^Zadania/ }).click();
    const row = page.locator('.task-row').filter({ hasText: `${marker} projekt` });
    await expect(row).toBeVisible();
    await row.getByRole('button', { name: 'Ukończ zadanie', exact: true }).click();
    await page.getByRole('button', { name: 'Ukończone', exact: true }).click();
    await expect(row).toBeVisible();
    await page.reload();
    await page.getByRole('button', { name: 'Ukończone', exact: true }).click();
    await expect(row).toBeVisible();
    await page.screenshot({
      path: `test-results/${testInfo.project.name}-tasks.png`,
      fullPage: true,
    });
    bootstrap = await (await request.get('/api/bootstrap')).json();
    const task = bootstrap.tasks.find(
      (item: { title: string }) => item.title === `${marker} projekt`,
    );
    expect(task.status).toBe('done');
    expect(
      bootstrap.schedules.some((item: { subject_id: string }) => item.subject_id === subject.id),
    ).toBe(true);
    await request.delete(`/api/tasks/${task.id}`, { headers });
    await request.delete(`/api/subjects/${subject.id}`, { headers });
  });

  test('PDF.js rzeczywiście odczytuje strony PDF, ponowny import i skan wymagający OCR', async ({
    page,
    request,
  }, testInfo) => {
    const advanceCalls: string[] = [];
    page.on('request', (req) => {
      if (req.url().includes('/advance')) advanceCalls.push(req.url());
    });
    await page.goto('/#documents');
    await expect(page.getByRole('heading', { name: 'Dokumenty', exact: true })).toBeVisible();
    await page.getByLabel('Wybierz dokument PDF').setInputFiles(fixture('syllabus-exact.pdf'));
    const imported = page.waitForResponse(
      (response) =>
        response.url().endsWith('/api/documents') && response.request().method() === 'POST',
    );
    await page.getByRole('button', { name: 'Odczytaj i analizuj', exact: true }).click();
    const importResponse = await imported;
    expect(importResponse.ok()).toBe(true);
    const payload = importResponse.request().postDataJSON();
    expect(payload.pages).toHaveLength(2);
    expect(payload.pages[0].text).toContain('20.11.2026');
    expect(payload.pages[1].text).toContain('22.01.2027');
    const first = await importResponse.json();
    await expect(
      page.getByRole('heading', { name: 'Aktywność agentów', exact: true }),
    ).toBeVisible();
    await page.goto('/#documents');
    await expect(
      page.getByRole('heading', { name: 'syllabus-exact.pdf', exact: true }),
    ).toBeVisible();
    await page.getByLabel('Wybierz dokument PDF').setInputFiles(fixture('syllabus-exact.pdf'));
    const repeated = page.waitForResponse(
      (response) =>
        response.url().endsWith('/api/documents') && response.request().method() === 'POST',
    );
    await page.getByRole('button', { name: 'Odczytaj i analizuj', exact: true }).click();
    const second = await (await repeated).json();
    expect(second.cached).toBe(true);
    expect(second.document.id).toBe(first.document.id);
    await expect(
      page.getByRole('heading', { name: 'Aktywność agentów', exact: true }),
    ).toBeVisible();
    await page.goto('/#documents');
    await page.getByLabel('Wybierz dokument PDF').setInputFiles(fixture('scan-no-text.pdf'));
    await page.getByRole('button', { name: 'Odczytaj i analizuj', exact: true }).click();
    await expect(page.getByRole('alert')).toContainText('OCR');
    await page.getByLabel('Wybierz dokument PDF').setInputFiles({
      name: 'nie-pdf.pdf',
      mimeType: 'application/pdf',
      buffer: Buffer.from('To nie jest PDF'),
    });
    await page.getByRole('button', { name: 'Odczytaj i analizuj', exact: true }).click();
    await expect(page.getByRole('alert')).toContainText('nagłówka PDF');
    expect(advanceCalls).toEqual([]);
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1),
    ).toBe(true);
    await page.screenshot({
      path: `test-results/${testInfo.project.name}-documents.png`,
      fullPage: true,
    });
    await request.delete(`/api/documents/${first.document.id}`, {
      headers: { Origin: 'http://localhost:8899' },
    });
  });
  test('nawigacja, brak poziomego przewijania i prywatność cache PWA', async ({
    page,
    request,
  }) => {
    await page.goto('/');
    await expect(page.getByRole('heading', { name: /Dzień dobry/ })).toBeVisible();
    for (const [hash, title] of [
      ['tasks', 'Zadania'],
      ['calendar', 'Kalendarz'],
      ['subjects', 'Przedmioty'],
      ['documents', 'Dokumenty'],
      ['activity', 'Aktywność agentów'],
      ['settings', 'Ustawienia'],
    ]) {
      await page.goto(`/#${hash}`);
      await expect(page.getByRole('heading', { name: title, exact: true })).toBeVisible();
      expect(
        await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1),
        hash,
      ).toBe(true);
    }
    const manifest = await (await request.get('/manifest.webmanifest')).json();
    expect(manifest).toMatchObject({ name: 'StudentOS', lang: 'pl', display: 'standalone' });
    for (const icon of manifest.icons) expect((await request.get(icon.src)).ok()).toBe(true);
    await page.evaluate(async () => {
      await navigator.serviceWorker.ready;
    });
    const cached = await page.evaluate(async () => {
      const names = await caches.keys();
      return (
        await Promise.all(
          names.map(async (name) => (await (await caches.open(name)).keys()).map((req) => req.url)),
        )
      ).flat();
    });
    expect(cached.every((url) => !url.includes('/api/'))).toBe(true);
  });
});
