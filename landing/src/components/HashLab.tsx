import { useEffect, useState } from "react";
import { sha256Hex } from "../lib/sha256";
import { CALL } from "../lib/content";

const ORIGINAL = CALL.turns.map((turn) => `${turn.speaker === "dispatch" ? "Dispatch" : "Them"}: ${turn.text}`).join("\n");

/** Edit the transcript and watch its fingerprint change: why a hashed record can't be quietly rewritten. */
export function HashLab() {
  const [text, setText] = useState(ORIGINAL);
  const [hash, setHash] = useState("");
  const [originalHash, setOriginalHash] = useState("");

  useEffect(() => {
    let cancelled = false;
    void sha256Hex(ORIGINAL).then((value) => {
      if (!cancelled) setOriginalHash(value);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    void sha256Hex(text).then((value) => {
      if (!cancelled) setHash(value);
    });
    return () => {
      cancelled = true;
    };
  }, [text]);

  const tampered = hash !== "" && originalHash !== "" && hash !== originalHash;

  return (
    <div className={`lab ${tampered ? "is-tampered" : ""}`}>
      <label className="lab__label" htmlFor="lab-text">
        The transcript. Edit anything.
      </label>
      <textarea
        id="lab-text"
        className="lab__input"
        value={text}
        onChange={(event) => setText(event.target.value)}
        spellCheck={false}
        rows={7}
      />
      <code className="lab__hash" aria-label="SHA-256 fingerprint">
        {Array.from(hash, (char, i) => (
          <span key={i} className={char !== originalHash[i] ? "is-changed" : ""}>
            {char}
          </span>
        ))}
      </code>
      <p className="lab__status" aria-live="polite">
        {tampered
          ? "This no longer matches the original. "
          : "SHA-256 of the text above, computed in your browser. The on-chain fingerprint covers the full result. "}
        {tampered && (
          <button type="button" className="text-button" onClick={() => setText(ORIGINAL)}>
            Put it back
          </button>
        )}
      </p>
    </div>
  );
}
