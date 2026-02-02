import { Button } from "../ui/Button";
import { TextInput } from "../ui/TextInput";

type Props = {
  pin: string;
  setPin: (pin: string) => void;
  name: string;
  setName: (name: string) => void;
  creating: boolean;
  joining: boolean;
  onCreateQuiz: () => void;
  onCreate: () => void;
  onJoin: () => void;
};

export function LandingPage({
  pin,
  setPin,
  name,
  setName,
  creating,
  joining,
  onCreateQuiz,
  onCreate,
  onJoin,
}: Props) {
  return (
    <>
      <section className="landingHero">
        <div className="landingEyebrow">
          <span className="landingBadge" aria-hidden>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
              <path
                d="M12 2 14.9 8.2 22 9 16.6 13.6 18.2 20.8 12 17.3 5.8 20.8 7.4 13.6 2 9l7.1-.8L12 2Z"
                stroke="currentColor"
                strokeWidth="1.6"
                strokeLinejoin="round"
              />
            </svg>
          </span>
          <span>Modern Kahoot-style quizzes</span>
        </div>
        <h1 className="landingTitle">Quizflare</h1>
        <div className="landingSubtitle">
          Create clean, modern quizzes and host a live game in seconds. Players join from mobile or laptop and answer as the timer
          counts down.
        </div>
      </section>

      <section className="landingGrid">
        <div className="card">
          <div className="cardTitleRow">
            <span className="cardIcon" aria-hidden>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                <path d="M4 11a8 8 0 1 0 16 0" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
                <path d="M12 3v8l4 2" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </span>
            <span className="cardTitle">Create / setup a quiz</span>
          </div>
          <div className="cardHint">Build your quiz first, then host it live. Your quizzes are saved to this browser (MVP ownership).</div>
          <div className="cardActions">
            <Button onClick={onCreateQuiz}>Create / setup</Button>
            <Button variant="secondary" onClick={onCreate} disabled={creating}>
              {creating ? "Creating…" : "Quick host"}
            </Button>
          </div>
        </div>

        <div className="card">
          <div className="cardTitleRow">
            <span className="cardIcon" aria-hidden>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                <path
                  d="M9.5 7.5a2.5 2.5 0 1 0 5 0 2.5 2.5 0 0 0-5 0Z"
                  stroke="currentColor"
                  strokeWidth="1.6"
                />
                <path
                  d="M4 20a6 6 0 0 1 16 0"
                  stroke="currentColor"
                  strokeWidth="1.6"
                  strokeLinecap="round"
                />
              </svg>
            </span>
            <span className="cardTitle">Join a live game</span>
          </div>
          <div className="cardHint">Enter the room PIN and your name. You’ll connect automatically.</div>
          <div className="cardFields">
            <TextInput label="Room PIN" value={pin} onChange={setPin} placeholder="000000" inputMode="numeric" maxLength={6} />
            <TextInput label="Name" value={name} onChange={setName} placeholder="Your name" />
          </div>
          <div className="cardActions">
            <Button variant="secondary" onClick={onJoin} disabled={joining || !pin.trim() || !name.trim()}>
              {joining ? "Joining…" : "Join"}
            </Button>
          </div>
        </div>
      </section>
    </>
  );
}
