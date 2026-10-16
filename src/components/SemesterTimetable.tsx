export interface SemesterTimetableData {
  id: string;
  title: string;
  academic_year: string;
  semester: string;
  group: string;
  starts_on: string;
  source: string;
  notes: string;
  venues: string[];
  entries: {
    subject_name: string;
    weekday: number;
    start_time: string;
    end_time: string;
    class_type: string;
    location: string;
    notes: string;
  }[];
}

const weekdays = ['Poniedziałek', 'Wtorek', 'Środa', 'Czwartek', 'Piątek'];

export function SemesterTimetable({ timetable }: { timetable: SemesterTimetableData }) {
  return (
    <section className="panel semester-timetable" aria-label="Wgrany plan semestru">
      <div className="panel-heading">
        <div>
          <h2>Twój plan semestru · {timetable.academic_year}</h2>
          <p>{timetable.title}</p>
        </div>
        <span className="badge lavender">{timetable.group}</span>
      </div>
      <p className="timetable-context">
        Semestr {timetable.semester} · początek {timetable.starts_on.split('-').reverse().join('.')}{' '}
        · {timetable.source}
      </p>
      <p className="timetable-context">{timetable.notes}</p>
      <div className="timetable-days">
        {weekdays.map((day, index) => {
          const entries = timetable.entries.filter((entry) => entry.weekday === index + 1);
          return (
            <section className="timetable-day" key={day}>
              <h3>{day}</h3>
              {entries.length ? (
                entries.map((entry, i) => (
                  <article className="timetable-class" key={i}>
                    <span className="event-time">
                      {entry.start_time}–{entry.end_time} · {entry.class_type}
                    </span>
                    <strong>{entry.subject_name}</strong>
                    <span>{entry.location}</span>
                    <small>{entry.notes}</small>
                  </article>
                ))
              ) : (
                <p className="day-empty">Brak zajęć w planie</p>
              )}
            </section>
          );
        })}
      </div>
      <details className="timetable-context">
        <summary>Adresy budynków</summary>
        {timetable.venues.map((venue) => (
          <p key={venue}>{venue}</p>
        ))}
      </details>
    </section>
  );
}
