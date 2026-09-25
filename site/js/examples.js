// Example journal shown on first visit, so the scoring is visible before
// anyone has logged a prediction. Dates are placed relative to today.
// The example forecaster is a little overconfident at the high end.

import { addDays, toISODate } from './journal.js';

// [statement, probability, tag, outcome]
const RESOLVED = [
  ["The quarterly report goes out before Friday's deadline", 90, 'work', 'yes'],
  ['The team ships the new onboarding flow this sprint', 80, 'work', 'no'],
  ['I finish the book club novel before the meeting', 70, 'personal', 'yes'],
  ['I go running at least three times this week', 75, 'fitness', 'no'],
  ['The contractor finishes the bathroom within the quoted two weeks', 60, 'home', 'no'],
  ['My flight on the 14th leaves on time', 85, 'personal', 'yes'],
  ['Grocery spending stays under budget this month', 65, 'money', 'yes'],
  ['The client signs the renewal this month', 90, 'work', 'yes'],
  ['I walk 10,000 steps every day this week', 40, 'fitness', 'no'],
  ['The job interview leads to a second round', 55, 'work', 'yes'],
  ['The hiring plan gets approved without changes', 30, 'work', 'no'],
  ['I can do 10 pull-ups by the end of the month', 25, 'fitness', 'no'],
  ["The heating bill comes in lower than last winter's", 70, 'money', 'yes'],
  ['My sister visits in October', 95, 'personal', 'yes'],
  ['The bug fix passes review on the first try', 80, 'work', 'yes'],
  ['I finish the online course module this week', 85, 'personal', 'no'],
  ['The old bike sells within a week of listing it', 50, 'money', 'yes'],
  ['Rent goes up at the lease renewal', 90, 'money', 'yes'],
  ['The server migration finishes without downtime', 95, 'work', 'no'],
  ['I keep my phone out of the bedroom all week', 60, 'personal', 'no'],
  ['The tomatoes ripen before September', 80, 'home', 'yes'],
  ['The project kickoff happens on the planned date', 75, 'work', 'yes'],
  ['I sleep seven hours or more on at least five nights', 45, 'fitness', 'yes'],
  ['The landlord fixes the window within 30 days', 35, 'home', 'no'],
  ['The presentation runs under 20 minutes', 70, 'work', 'no'],
  ['I order no takeout for two weeks', 20, 'money', 'no'],
  ['The package arrives before the weekend', 85, 'personal', 'yes'],
  ['Our talk proposal gets accepted for the conference', 15, 'work', 'no'],
  ['I run the 10K in under 55 minutes', 65, 'fitness', 'yes'],
  ['The car passes its inspection first time', 80, 'money', 'yes'],
  ['The new hire accepts the offer', 70, 'work', 'yes'],
  ['I read two books this month', 90, 'personal', 'no'],
  ['The holiday savings target is reached by June', 60, 'money', 'yes'],
  ["The neighbours' party ends before midnight", 50, 'home', 'void'],
];

// [statement, probability, tag, days from today until the check date]
const OPEN = [
  ['The design review is scheduled before the end of the month', 70, 'work', -1],
  ['The new electricity contract comes in cheaper than the old one', 55, 'money', 20],
  ['I run a half marathon this year', 40, 'fitness', 60],
];

export function examplePredictions(now = new Date()) {
  const predictions = [];
  const start = addDays(now, -RESOLVED.length * 5 - 20);

  RESOLVED.forEach(([statement, probability, tag, outcome], i) => {
    const created = addDays(start, i * 5);
    const checkDate = addDays(created, 14);
    predictions.push({
      id: `example-${i + 1}`,
      statement,
      probability,
      createdAt: created.toISOString(),
      resolveBy: toISODate(checkDate),
      tag,
      notes: '',
      outcome,
      resolvedAt: checkDate.toISOString(),
      example: true,
    });
  });

  OPEN.forEach(([statement, probability, tag, days], i) => {
    predictions.push({
      id: `example-open-${i + 1}`,
      statement,
      probability,
      createdAt: addDays(now, -10 - i * 3).toISOString(),
      resolveBy: toISODate(addDays(now, days)),
      tag,
      notes: '',
      outcome: null,
      resolvedAt: null,
      example: true,
    });
  });

  return predictions;
}
