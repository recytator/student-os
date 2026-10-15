import { describe, expect, it } from 'vitest';
import {
  dateSchema,
  instantSchema,
  documentUploadSchema,
  proposedTaskSchema,
  reviewAgentOutputSchema,
  subjectInputSchema,
  taskInputSchema,
} from '../../shared/contracts';

const upload = {
  name: 'Sylabus.pdf',
  hash: 'a'.repeat(64),
  subject_id: null,
  academic_year: '2026/2027',
  pages: [{ page: 1, text: 'Projekt nalezy oddac do 20.11.2026.' }],
};

describe('wspólne kontrakty walidacyjne', () => {
  it('akceptuje rzeczywiste daty przestępne i odrzuca nieistniejące', () => {
    expect(dateSchema.safeParse('2028-02-29').success).toBe(true);
    for (const value of ['2027-02-29', '2026-02-31', '20.11.2026', '2026-13-01'])
      expect(dateSchema.safeParse(value).success).toBe(false);
  });
  it('odrzuca nieprawidłowy offset strefy czasowej', () => {
    expect(instantSchema.safeParse('2026-11-20T10:00:00+25:00').success).toBe(false);
    expect(instantSchema.safeParse('2026-11-20T10:00:00+01:00').success).toBe(true);
  });
  it('blokuje nieznane pola zamiast przyjmować user_id od klienta', () => {
    expect(subjectInputSchema.safeParse({ name: 'AI', user_id: 'other-user' }).success).toBe(false);
    expect(taskInputSchema.safeParse({ title: 'Projekt', user_id: 'other-user' }).success).toBe(
      false,
    );
  });
  it('odrzuca skan bez tekstu, duplikaty stron i dokument ponad budżet', () => {
    expect(documentUploadSchema.safeParse(upload).success).toBe(true);
    expect(
      documentUploadSchema.safeParse({ ...upload, pages: [{ page: 1, text: '' }] }).success,
    ).toBe(false);
    expect(
      documentUploadSchema.safeParse({ ...upload, pages: [...upload.pages, ...upload.pages] })
        .success,
    ).toBe(false);
    expect(
      documentUploadSchema.safeParse({
        ...upload,
        pages: Array.from({ length: 7 }, (_, i) => ({ page: i + 1, text: 'a'.repeat(30000) })),
      }).success,
    ).toBe(false);
  });
  it('wymaga dowodu źródłowego dla każdej propozycji', () => {
    const proposal = {
      id: 'p1',
      title: 'Projekt',
      subject_id: null,
      due_date: null,
      priority: 'medium',
      estimated_minutes: null,
      sources: [],
      confidence: 0.5,
      requires_confirmation: true,
      duplicate_of: null,
    };
    expect(proposedTaskSchema.safeParse(proposal).success).toBe(false);
    expect(
      proposedTaskSchema.safeParse({
        ...proposal,
        sources: [{ page: 1, quote: 'Projekt do ustalenia.' }],
      }).success,
    ).toBe(true);
  });
  it('odrzuca pozorny raport ReviewAgent z nieznaną strukturą', () => {
    expect(reviewAgentOutputSchema.safeParse({ accepted: true }).success).toBe(false);
    expect(
      reviewAgentOutputSchema.safeParse({
        accepted_ids: [],
        rejected_ids: [],
        issues: [],
        needs_revision: false,
        revise_agent: null,
        summary: 'Brak propozycji.',
      }).success,
    ).toBe(true);
  });
});
