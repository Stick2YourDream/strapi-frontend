import { useEffect, useMemo, useState } from "react";
import "../css/goals-panel.css";

type GroupOption = {
  id: number;
  name: string;
};

type FriendOption = {
  id: number;
  label: string;
};

type CheckInEntry = {
  id: string;
  createdAt: string;
  type: "check-in" | "support-request";
  goal: string;
  note: string;
  target: "private" | "trusted" | "feed";
  groupId?: number;
  groupName?: string;
};

type GoalsState = {
  selectedGoals: string[];
  customGoals: string[];
  achievedGoals: string[];
  trustedFriendIds: number[];
  reminder: "daily" | "weekly" | "off";
  trustedCircleIds: number[];
  checkIns: CheckInEntry[];
};

type GoalsImpactPanelProps = {
  userId?: number | null;
  groups: GroupOption[];
  friends: FriendOption[];
  onStateChange?: (state: GoalsState) => void;
};

const GOAL_LIBRARY = [
  "Wake up on time",
  "Morning walk",
  "Daily stretch",
  "Drink 64 oz of water",
  "Workout 3x per week",
  "Run a 5K",
  "Strength training routine",
  "Meal prep this week",
  "Cook at home 4 nights",
  "Reduce sugar intake",
  "Eat more vegetables",
  "Track calories",
  "Sleep 8 hours",
  "Go to bed by 10:30 PM",
  "No phone after 9 PM",
  "Meditate 10 minutes",
  "Journal every day",
  "Practice gratitude",
  "Read 20 pages",
  "Finish one book",
  "Learn a new skill",
  "Take an online course",
  "Complete certification",
  "Apply to 5 jobs",
  "Update resume",
  "Build a portfolio",
  "Launch a side project",
  "Ship a weekly feature",
  "Write 1,000 words",
  "Start a newsletter",
  "Post a weekly update",
  "Build a budget",
  "Save $500",
  "Pay off a credit card",
  "Track spending",
  "Start investing",
  "Emergency fund",
  "Call family weekly",
  "Plan a date night",
  "Meet a new friend",
  "Join a community group",
  "Volunteer once a month",
  "Daily affirmations",
  "Therapy session",
  "No caffeine after 2 PM",
  "Limit social media",
  "Declutter a room",
  "Clean for 20 minutes",
  "Organize workspace",
  "Plan weekly schedule",
  "Finish a project",
  "Hit inbox zero",
  "Study 30 minutes",
  "Practice a language",
  "Learn guitar",
  "Draw or sketch",
  "Create a playlist",
  "Write a poem",
  "Practice public speaking",
  "Record a video",
  "Go outside daily",
  "Hit 8,000 steps",
  "Stretch before bed",
  "Skincare routine",
  "Cook a new recipe",
  "Practice mindfulness",
  "Take a break walk",
  "Build a habit tracker",
  "Start a savings plan",
  "Limit alcohol",
  "No fast food this week",
  "Meal plan on Sundays",
  "Read the news mindfully",
  "Daily check-in",
  "Reflect on the day",
  "Celebrate small wins",
  "Share a win",
  "Ask for help",
  "Encourage someone",
  "Send a thank you",
  "Plan a weekly goal",
  "Review weekly goals",
  "Track mood",
  "Therapy homework",
  "Learn to code",
  "Practice typing",
  "Study for exams",
  "Publish a blog post",
  "Pitch a client",
  "Close one deal",
  "Design a logo",
  "Sketch a product idea",
  "Save for a trip",
  "Plan a weekend reset",
  "Limit screen time",
  "Create a vision board",
  "Daily prayer",
  "Run errands early",
  "Do laundry",
  "Clean the car",
  "Take vitamins",
  "Practice breathing",
  "Hit protein goal",
  "Plan meals",
  "Build confidence",
  "Finish a course module",
  "Network with a mentor",
  "Set boundaries",
  "Respond to messages",
  "Plan a celebration",
];

const storageKeyFor = (userId?: number | null) =>
  userId ? `ysp-goals-${userId}` : "ysp-goals-guest";

const loadState = (key: string): GoalsState => {
  if (typeof window === "undefined") {
    return {
      selectedGoals: [],
      customGoals: [],
      achievedGoals: [],
      trustedFriendIds: [],
      reminder: "weekly",
      trustedCircleIds: [],
      checkIns: [],
    };
  }
  const raw = window.localStorage.getItem(key);
  if (!raw) {
    return {
      selectedGoals: [],
      customGoals: [],
      achievedGoals: [],
      trustedFriendIds: [],
      reminder: "weekly",
      trustedCircleIds: [],
      checkIns: [],
    };
  }
  try {
    const parsed = JSON.parse(raw) as Partial<
      GoalsState & { trustedGroupIds?: number[] }
    > | null;
    return {
      selectedGoals: parsed?.selectedGoals ?? [],
      customGoals: parsed?.customGoals ?? [],
      achievedGoals: parsed?.achievedGoals ?? [],
      trustedFriendIds: parsed?.trustedFriendIds ?? [],
      reminder: parsed?.reminder ?? "weekly",
      trustedCircleIds: parsed?.trustedCircleIds ?? parsed?.trustedGroupIds ?? [],
      checkIns: parsed?.checkIns ?? [],
    };
  } catch {
    return {
      selectedGoals: [],
      customGoals: [],
      achievedGoals: [],
      trustedFriendIds: [],
      reminder: "weekly",
      trustedCircleIds: [],
      checkIns: [],
    };
  }
};

const saveState = (key: string, state: GoalsState) => {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(key, JSON.stringify(state));
};

const formatDate = (value: string) =>
  new Date(value).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  });

export default function GoalsImpactPanel({
  userId,
  onStateChange,
}: GoalsImpactPanelProps) {
  const storageKey = useMemo(() => storageKeyFor(userId), [userId]);
  const [goalPicker, setGoalPicker] = useState("");
  const [customGoalInput, setCustomGoalInput] = useState("");
  const [lastAddedGoal, setLastAddedGoal] = useState<string | null>(null);
  const [checkInIndex, setCheckInIndex] = useState(0);

  const [state, setState] = useState<GoalsState>(() => loadState(storageKey));

  useEffect(() => {
    setState(loadState(storageKey));
  }, [storageKey]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const handleSync = () => setState(loadState(storageKey));
    window.addEventListener("ysp-goals-updated", handleSync);
    return () => window.removeEventListener("ysp-goals-updated", handleSync);
  }, [storageKey]);

  useEffect(() => {
    saveState(storageKey, state);
    onStateChange?.(state);
  }, [state, storageKey, onStateChange]);

  const selectedGoals = state.selectedGoals;
  const customGoals = state.customGoals;
  const achievedGoals = state.achievedGoals;
  const checkIns = state.checkIns;
  const orderedCheckIns = useMemo(
    () =>
      [...checkIns].sort(
        (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
      ),
    [checkIns]
  );
  useEffect(() => {
    if (orderedCheckIns.length === 0) {
      setCheckInIndex(0);
      return;
    }
    setCheckInIndex((prev) => Math.min(prev, orderedCheckIns.length - 1));
  }, [orderedCheckIns.length]);
  const activeGoals = useMemo(
    () => Array.from(new Set([...(selectedGoals || []), ...(customGoals || [])])),
    [customGoals, selectedGoals]
  );

  const filteredGoals = useMemo(() => GOAL_LIBRARY, []);

  const toggleGoal = (goal: string) => {
    setState((prev) => {
      const exists = prev.selectedGoals.includes(goal);
      const nextSelected = exists
        ? prev.selectedGoals.filter((item) => item !== goal)
        : [...prev.selectedGoals, goal];
      if (!exists) {
        setLastAddedGoal(goal);
      }
      return {
        ...prev,
        selectedGoals: nextSelected,
        achievedGoals: prev.achievedGoals.filter((item) => item !== goal),
      };
    });
  };

  const addCustomGoal = () => {
    const trimmed = customGoalInput.trim();
    if (!trimmed) return;
    setState((prev) => {
      if (prev.customGoals.includes(trimmed)) return prev;
      setLastAddedGoal(trimmed);
      return {
        ...prev,
        customGoals: [...prev.customGoals, trimmed],
        achievedGoals: prev.achievedGoals.filter((goal) => goal !== trimmed),
      };
    });
    setCustomGoalInput("");
  };

  const removeGoal = (goal: string) => {
    setState((prev) => ({
      ...prev,
      customGoals: prev.customGoals.filter((item) => item !== goal),
      selectedGoals: prev.selectedGoals.filter((item) => item !== goal),
      achievedGoals: prev.achievedGoals.filter((item) => item !== goal),
    }));
    if (lastAddedGoal === goal) {
      setLastAddedGoal(null);
    }
  };

  const markGoalAchieved = (goal: string) => {
    setState((prev) => {
      if (prev.achievedGoals.includes(goal)) return prev;
      return {
        ...prev,
        selectedGoals: prev.selectedGoals.filter((item) => item !== goal),
        customGoals: prev.customGoals.filter((item) => item !== goal),
        achievedGoals: [...prev.achievedGoals, goal],
      };
    });
    if (lastAddedGoal === goal) {
      setLastAddedGoal(null);
    }
  };

  const reactivateGoal = (goal: string) => {
    setState((prev) => {
      const isLibrary = GOAL_LIBRARY.includes(goal);
      const nextSelected = isLibrary
        ? Array.from(new Set([...prev.selectedGoals, goal]))
        : prev.selectedGoals;
      const nextCustom = isLibrary
        ? prev.customGoals
        : Array.from(new Set([...prev.customGoals, goal]));
      return {
        ...prev,
        selectedGoals: nextSelected,
        customGoals: nextCustom,
        achievedGoals: prev.achievedGoals.filter((item) => item !== goal),
      };
    });
  };

  const handleStartCheckIn = (goal?: string | null) => {
    if (typeof window === "undefined") return;
    const detail = { goal: goal || "" };
    window.dispatchEvent(new CustomEvent("ysp-goals-start-checkin", { detail }));
    const target = window.document?.getElementById("post-composer");
    target?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  return (
    <section className="panel goals-panel">
      <div className="panel-header">
        <div>
          <p className="eyebrow">Goals & Impact</p>
          <h3>Set goals, track progress, and stay supported.</h3>
          <p className="panel-sub">
            Choose goals and review recent check-ins.
          </p>
        </div>
      </div>

      <div className="goals-panel__grid">
        <div className="goals-panel__column">
          <div className="goals-panel__section">
            <div className="goals-panel__header">
              <h4>Your goals</h4>
              <span>
                {activeGoals.length} active · {achievedGoals.length} achieved
              </span>
            </div>
            <div className="goals-panel__selected">
              {activeGoals.map((goal) => (
                <div key={goal} className="goals-row">
                  <span className="goals-row__label">{goal}</span>
                  <div className="goals-row__actions">
                    <button
                      className="goals-row__action"
                      type="button"
                      onClick={() => markGoalAchieved(goal)}
                    >
                      Achieved
                    </button>
                    <button
                      className="goals-row__action goals-row__action--danger"
                      type="button"
                      onClick={() => removeGoal(goal)}
                    >
                      Remove
                    </button>
                  </div>
                </div>
              ))}
              {activeGoals.length === 0 && (
                <p className="goals-empty">
                  Add a goal to get started. Completed goals will appear below.
                </p>
              )}
            </div>
            <div className="goals-panel__picker">
              <div className="goals-panel__steps">
                <span className="goals-step">1. Choose a goal</span>
                <span className="goals-step">2. Add it to your list</span>
                <span className="goals-step">3. Start a check-in</span>
              </div>
              <div className="goals-panel__picker-row">
                <div className="goals-panel__select">
                  <select
                    className="auth-input goals-select"
                    value={goalPicker}
                    onChange={(event) => setGoalPicker(event.target.value)}
                  >
                    <option value="">Select a goal</option>
                    {filteredGoals.map((goal) => (
                      <option
                        key={goal}
                        value={goal}
                        disabled={selectedGoals.includes(goal)}
                      >
                        {goal}
                      </option>
                    ))}
                  </select>
                  <span className="goals-select-caret" />
                </div>
                <button
                  className="btn ghost"
                  type="button"
                  onClick={() => {
                    if (!goalPicker) return;
                    if (!selectedGoals.includes(goalPicker)) {
                      toggleGoal(goalPicker);
                    }
                    setGoalPicker("");
                  }}
                  disabled={!goalPicker}
                >
                  Add to goals
                </button>
              </div>
              <p className="goals-muted">
                Pick a goal, tap “Add to goals,” and it will appear above.
              </p>
            </div>
            <div className="goals-panel__custom">
              <input
                className="auth-input"
                placeholder="Add a custom goal"
                value={customGoalInput}
                onChange={(event) => setCustomGoalInput(event.target.value)}
              />
              <button className="btn primary" type="button" onClick={addCustomGoal}>
                Add goal
              </button>
            </div>
            {(lastAddedGoal || selectedGoals.length + customGoals.length > 0) && (
              <div className="goals-panel__next">
                <div>
                  <strong>Next step</strong>
                  <p>
                    Start a quick check-in{lastAddedGoal ? ` for "${lastAddedGoal}"` : ""}.
                  </p>
                </div>
                <button
                  className="btn primary"
                  type="button"
                  onClick={() => handleStartCheckIn(lastAddedGoal)}
                >
                  Start check-in
                </button>
              </div>
            )}
            {achievedGoals.length > 0 && (
              <div className="goals-panel__achieved">
                <div className="goals-panel__header goals-panel__header--tight">
                  <h5>Achieved goals</h5>
                  <span>{achievedGoals.length} completed</span>
                </div>
                <div className="goals-panel__achieved-list">
                  {achievedGoals.map((goal) => (
                    <div key={goal} className="goals-row goals-row--achieved">
                      <span className="goals-row__label">{goal}</span>
                      <div className="goals-row__actions">
                        <button
                          className="goals-row__action"
                          type="button"
                          onClick={() => reactivateGoal(goal)}
                        >
                          Reactivate
                        </button>
                        <button
                          className="goals-row__action goals-row__action--danger"
                          type="button"
                          onClick={() => removeGoal(goal)}
                        >
                          Remove
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
                <p className="goals-muted">Nice work. These stay here as your wins.</p>
              </div>
            )}
          </div>

        </div>

        <div className="goals-panel__column">
          <div className="goals-panel__section">
            <div className="goals-panel__header">
              <h4>Recent check-ins</h4>
              <span>Your private log</span>
            </div>
            {orderedCheckIns.length === 0 && (
              <p className="goals-empty">Your recent check-ins will appear here.</p>
            )}
            {orderedCheckIns.length > 0 && (
              <div className="goals-panel__history">
                {orderedCheckIns[checkInIndex] && (
                  <div
                    key={orderedCheckIns[checkInIndex].id}
                    className="goals-history-item"
                  >
                    <div>
                      <strong>{orderedCheckIns[checkInIndex].goal}</strong>
                      <p>{orderedCheckIns[checkInIndex].note}</p>
                    </div>
                    <div className="goals-history-meta">
                      <span>
                        {orderedCheckIns[checkInIndex].type === "support-request"
                          ? "Support"
                          : "Check-in"}
                      </span>
                      <span>
                        {orderedCheckIns[checkInIndex].target === "trusted" &&
                        orderedCheckIns[checkInIndex].groupName
                          ? orderedCheckIns[checkInIndex].groupName
                          : orderedCheckIns[checkInIndex].target === "feed"
                          ? "My feed"
                          : "Only me"}
                      </span>
                      <span>{formatDate(orderedCheckIns[checkInIndex].createdAt)}</span>
                    </div>
                    {orderedCheckIns.length > 1 && (
                      <div className="goals-history-controls goals-history-controls--overlay">
                        <button
                          type="button"
                          onClick={() =>
                            setCheckInIndex(
                              (prev) =>
                                (prev - 1 + orderedCheckIns.length) % orderedCheckIns.length
                            )
                          }
                          aria-label="Previous check-in"
                        >
                          Prev
                        </button>
                        <span className="goals-history-count">
                          {checkInIndex + 1} / {orderedCheckIns.length}
                        </span>
                        <button
                          type="button"
                          onClick={() =>
                            setCheckInIndex((prev) => (prev + 1) % orderedCheckIns.length)
                          }
                          aria-label="Next check-in"
                        >
                          Next
                        </button>
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}
