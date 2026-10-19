import { expect, test, type Page } from '@playwright/test';
import { fileURLToPath } from 'node:url';

const fixture = (name: string) => fileURLToPath(new URL(`../fixtures/${name}`, import.meta.url));
const headers = { Origin: 'http://localhost:8899' };
const noHorizontalScroll = (page: Page) =>
  page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);

test.describe('StudentOS — prawdziwy interfejs i lokalne dane', () => {
  test.afterEach(async ({ request }) => {
    const response = await request.get('/api/bootstrap');
    if (!response.ok()) return;
    const data = await response.json();
    const marker = /^UI-(?:android|desktop)-chromium-\d+/;
    for (const task of data.tasks.filter((item: { title: string }) => marker.test(item.title)))
      await request.delete(`/api/tasks/${task.id}`, { headers });
    for (const subject of data.subjects.filter((item: { name: string }) => marker.test(item.name)))
      await request.delete(`/api/subjects/${subject.id}`, { headers });
  });

  test('plan GL2 jest prawdziwym planem tygodnia z zajęciami do potwierdzenia', async ({
    page,
    request,
  }) => {
    const bootstrap = await (await request.get('/api/bootstrap')).json();
    expect(bootstrap.schedules.filter((s: { id: string }) => s.id.startsWith('tt-'))).toHaveLength(
      18,
    );
    await page.goto('/#plan');
    await expect(page.getByRole('heading', { name: 'Plan', exact: true })).toBeVisible();
    await page.getByRole('tab', { name: 'Zajęcia', exact: true }).click();
    const tuesday = page.locator('.schedule-day').filter({ hasText: 'Wtorek' });
    const gl2 = tuesday.locator('.schedule-entry').filter({ hasText: 'GL2' });
    await expect(gl2).toContainText('17:00');
    await expect(gl2).toContainText('19:45');
    await expect(gl2).toContainText('10 spotkań, od 10.11.2026');
    await expect(gl2).toContainText('10.11.2026 – 31.01.2027');
    await expect(page.getByText('GL1', { exact: true })).toHaveCount(0);
    expect(await page.locator('.schedule-entry').filter({ hasText: 'do ustalenia' }).count()).toBe(
      12,
    );
    expect(await noHorizontalScroll(page)).toBe(true);
    await page.reload();
    await page.getByRole('tab', { name: 'Zajęcia', exact: true }).click();
    await expect(gl2).toBeVisible();
  });

  test('przedmiot, zajęcia, szybkie zadanie i ukończenie z cofnięciem', async ({
    page,
    request,
  }, testInfo) => {
    const marker = `UI-${testInfo.project.name}-${Date.now()}`;
    await page.goto('/#subjects');
    await expect(page.getByRole('heading', { name: 'Przedmioty', exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Nowy przedmiot', exact: true }).first().click();
    await page.getByLabel('Nazwa przedmiotu').fill(marker);
    await page.getByLabel('Prowadzący').fill('Prowadzący testowy');
    await page.getByRole('button', { name: 'Zapisz przedmiot', exact: true }).click();
    await expect(page.getByRole('heading', { name: marker, exact: true })).toBeVisible();
    let bootstrap = await (await request.get('/api/bootstrap')).json();
    const subject = bootstrap.subjects.find((item: { name: string }) => item.name === marker);
    expect(subject).toBeTruthy();

    await page
      .locator('.card')
      .filter({ hasText: 'Zajęcia' })
      .getByRole('button', { name: 'Dodaj' })
      .click();
    const dialog = page.getByRole('dialog');
    await expect(dialog.getByRole('combobox', { name: 'Przedmiot', exact: true })).toHaveValue(
      subject.id,
    );
    await dialog.getByRole('combobox', { name: 'Dzień tygodnia', exact: true }).selectOption('1');
    await dialog.getByLabel('Rodzaj zajęć').fill('laboratorium');
    await dialog.getByLabel('Początek', { exact: true }).fill('10:00');
    await dialog.getByLabel('Koniec', { exact: true }).fill('11:30');
    await dialog.getByLabel('Obowiązuje od').fill('2026-10-01');
    await dialog.getByLabel('Obowiązuje do').fill('2027-02-01');
    await dialog.getByLabel('Sala / miejsce').fill('Sala QA');
    await dialog.getByRole('button', { name: 'Zapisz zajęcia', exact: true }).click();
    await expect(dialog).toHaveCount(0);
    await expect(page.locator('.schedule-entry').filter({ hasText: 'Sala QA' })).toContainText(
      'laboratorium',
    );

    await page.getByLabel('Szybkie dodawanie zadania').fill(`${marker} kolokwium jutro !`);
    await page.getByLabel('Szybkie dodawanie zadania').press('Enter');
    const quick = page.locator('.task-row').filter({ hasText: `${marker} kolokwium` });
    await expect(quick).toContainText('Kolokwium');
    await expect(quick).toContainText('Jutro');

    await page.getByRole('button', { name: 'Nowe zadanie', exact: true }).first().click();
    await dialog.getByLabel('Co chcesz zrobić?').fill(`${marker} projekt`);
    await dialog.getByRole('tab', { name: 'Projekt', exact: true }).click();
    await dialog.getByRole('combobox', { name: 'Przedmiot', exact: true }).selectOption(subject.id);
    await dialog.getByLabel('Termin', { exact: true }).fill('2026-11-20');
    await dialog.getByRole('combobox', { name: 'Priorytet', exact: true }).selectOption('high');
    await dialog.getByRole('button', { name: 'Zapisz zadanie', exact: true }).click();
    await expect(dialog).toHaveCount(0);

    const nav = testInfo.project.name.startsWith('android')
      ? page.getByRole('navigation', { name: 'Nawigacja mobilna' })
      : page.getByRole('navigation', { name: 'Nawigacja główna' });
    await nav.getByRole('link', { name: /^Zadania/ }).click();
    await expect(page.getByRole('heading', { name: 'Zadania', exact: true })).toBeVisible();
    const row = page.locator('.task-row').filter({ hasText: `${marker} projekt` });
    await expect(row).toContainText('Projekt');
    await row.getByRole('button', { name: 'Ukończ zadanie', exact: true }).click();
    await expect(row).toHaveCount(0);
    await page.getByRole('button', { name: 'Cofnij', exact: true }).click();
    await expect(row).toBeVisible();
    await row.getByRole('button', { name: 'Ukończ zadanie', exact: true }).click();
    await expect(row).toHaveCount(0);
    await page.getByRole('tab', { name: 'Ukończone', exact: true }).click();
    await expect(row).toBeVisible();
    await page.reload();
    await page.getByRole('tab', { name: 'Ukończone', exact: true }).click();
    await expect(row).toBeVisible();
    expect(await noHorizontalScroll(page)).toBe(true);
    await page.screenshot({
      path: `test-results/${testInfo.project.name}-tasks.png`,
      fullPage: true,
    });

    bootstrap = await (await request.get('/api/bootstrap')).json();
    const task = bootstrap.tasks.find(
      (item: { title: string }) => item.title === `${marker} projekt`,
    );
    expect(task).toMatchObject({
      status: 'done',
      kind: 'project',
      priority: 'high',
      due_date: '2026-11-20',
    });
    const quickTask = bootstrap.tasks.find(
      (item: { title: string }) => item.title === `${marker} kolokwium`,
    );
    expect(quickTask).toMatchObject({ kind: 'colloquium', priority: 'high', status: 'todo' });
    expect(
      bootstrap.schedules.some(
        (item: { subject_id: string; class_type: string }) =>
          item.subject_id === subject.id && item.class_type === 'laboratorium',
      ),
    ).toBe(true);
  });

  test('PDF.js i PPTX czytane na urządzeniu, ponowny import, skan wymagający OCR', async ({
    page,
    request,
  }, testInfo) => {
    const advanceCalls: string[] = [];
    page.on('request', (req) => {
      if (req.url().includes('/advance')) advanceCalls.push(req.url());
    });
    const upload = async (file: string | Parameters<Page['setInputFiles']>[1]) => {
      await page.goto('/#materials');
      await expect(page.getByRole('heading', { name: 'Materiały', exact: true })).toBeVisible();
      await page
        .getByLabel('Wybierz plik')
        .setInputFiles(typeof file === 'string' ? fixture(file) : file);
      await page.getByRole('tab', { name: 'Tylko zapisz', exact: true }).click();
    };
    const save = async () => {
      const response = page.waitForResponse(
        (r) => r.url().endsWith('/api/documents') && r.request().method() === 'POST',
      );
      await page.getByRole('button', { name: 'Zapisz materiał', exact: true }).click();
      return response;
    };

    await upload('syllabus-exact.pdf');
    const imported = await save();
    expect(imported.ok()).toBe(true);
    const payload = imported.request().postDataJSON();
    expect(payload.pages).toHaveLength(2);
    expect(payload.pages[0].text).toContain('20.11.2026');
    expect(payload.pages[1].text).toContain('22.01.2027');
    const first = await imported.json();
    await expect(
      page.getByRole('heading', { name: 'syllabus-exact.pdf', exact: true }),
    ).toBeVisible();
    await page.getByRole('tab', { name: /^Terminy/ }).click();
    await expect(page.getByRole('button', { name: 'Przygotuj analizę terminów' })).toBeVisible();

    await upload('syllabus-exact.pdf');
    const second = await (await save()).json();
    expect(second.cached).toBe(true);
    expect(second.document.id).toBe(first.document.id);

    await upload('lecture.pptx');
    const slides = await save();
    const slidePayload = slides.request().postDataJSON();
    expect(slidePayload.pages.map((p: { page: number }) => p.page)).toEqual([1, 2]);
    expect(slidePayload.pages[0].text).toContain('Kamera otworkowa i macierz K');
    expect(slidePayload.pages[0].text).toContain('Notatki prowadzącego');
    const deck = await slides.json();
    await expect(page.getByRole('heading', { name: 'lecture.pptx', exact: true })).toBeVisible();
    await page.getByRole('tab', { name: 'Tekst', exact: true }).click();
    await expect(page.getByText('Slajd 2', { exact: true })).toBeVisible();
    await expect(page.getByText(/Stereowizja/)).toBeVisible();

    await upload('scan-no-text.pdf');
    await page.getByRole('button', { name: 'Zapisz materiał', exact: true }).click();
    await expect(page.getByRole('alert')).toContainText('OCR');
    await page.getByLabel('Wybierz plik').setInputFiles({
      name: 'nie-pdf.pdf',
      mimeType: 'application/pdf',
      buffer: Buffer.from('To nie jest PDF'),
    });
    await page.getByRole('button', { name: 'Zapisz materiał', exact: true }).click();
    await expect(page.getByRole('alert')).toContainText('nagłówka PDF');
    expect(advanceCalls).toEqual([]);
    expect(await noHorizontalScroll(page)).toBe(true);
    await page.screenshot({
      path: `test-results/${testInfo.project.name}-materials.png`,
      fullPage: true,
    });
    for (const id of [first.document.id, deck.document.id])
      await request.delete(`/api/documents/${id}`, { headers });
  });

  test('nawigacja, stare adresy, brak poziomego przewijania i prywatność cache PWA', async ({
    page,
    request,
  }) => {
    await page.goto('/');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(/Dzień dobry|Cześć/);
    for (const [hash, title] of [
      ['tasks', 'Zadania'],
      ['plan', 'Plan'],
      ['calendar', 'Plan'],
      ['subjects', 'Przedmioty'],
      ['materials', 'Materiały'],
      ['documents', 'Materiały'],
      ['analysis', 'Analizy terminów'],
      ['settings', 'Ustawienia'],
    ]) {
      await page.goto(`/#${hash}`);
      await expect(page.getByRole('heading', { name: title, exact: true })).toBeVisible();
      expect(await noHorizontalScroll(page), hash).toBe(true);
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
