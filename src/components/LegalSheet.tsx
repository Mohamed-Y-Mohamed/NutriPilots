import { Check } from "lucide-react";
import type { ReactNode } from "react";
import { Button, Sheet } from "./ui";

const TERMS_VERSION = "2026-08-10";

/**
 * Plain-English terms. Short on purpose — terms nobody reads protect nobody,
 * and the whole point of this screen is that the user actually reads it.
 */
export function LegalSheet({
  onClose,
  onAccept,
}: {
  onClose: () => void;
  /** Omitted when opened for reference rather than as part of sign-up. */
  onAccept?: () => void;
}) {
  return (
    <Sheet
      title="Terms of Use & Privacy"
      description={`Last updated ${TERMS_VERSION}. Please read before creating an account.`}
      onClose={onClose}
      footer={
        onAccept && (
          <Button variant="primary" size="lg" full onClick={onAccept}>
            <Check size={17} /> I have read and agree
          </Button>
        )
      }
    >
      <div className="grid gap-5 text-[13px] leading-relaxed text-ink-muted">
        <Clause title="1. What NutriPilot is">
          NutriPilot is a food diary and nutrition information tool. It helps you record what you
          eat and gives you estimates based on public nutrition data and AI. It is a general
          wellness app, nothing more.
        </Clause>

        <Clause title="2. Not medical or dietetic advice">
          NutriPilot does not provide medical, dietetic, or professional health advice, diagnosis,
          or treatment, and no doctor–patient or dietitian–client relationship is created by using
          it. Always speak to a qualified healthcare professional before changing your diet,
          especially if you are pregnant, breastfeeding, under 18, or living with diabetes, heart,
          kidney, or eating-disorder conditions. Never delay or disregard professional advice
          because of something you read here. If you feel unwell, contact a medical professional or
          your local emergency service.
        </Clause>

        <Clause title="3. Estimates are estimates">
          Calorie targets, macro splits, recipe nutrition, and AI photo analysis are approximations.
          Reference data comes from third-party sources, user-submitted entries are checked
          automatically but not by a human, and photo analysis is a visual guess. Figures may be
          wrong. Where accuracy matters, use the packaging label or a weighing scale.
        </Clause>

        <Clause title="4. Your responsibility">
          You decide what you eat. You are solely responsible for how you use the information in
          this app and for any decision you make based on it. Only enter information you are
          entitled to share, and keep your password to yourself.
        </Clause>

        <Clause title="5. Acceptable use">
          Use NutriPilot for personal nutrition tracking only. Do not use it to harm yourself or
          anyone else, to pursue dangerous levels of restriction, to submit deliberately false food
          data, to attempt to break, overload, scrape, or reverse-engineer the service, or for any
          unlawful purpose. Accounts that do may be suspended without notice.
        </Clause>

        <Clause title="6. AI features">
          Messages you send to the coach, and photos you upload for analysis, are processed by
          third-party AI providers to generate a reply. Photos are stored only for as long as the
          analysis takes and are then deleted; a text description of what the photo contained is
          kept for 30 days and then deleted automatically. Do not send anything confidential or
          anything containing another person&rsquo;s personal information. AI responses may be
          inaccurate.
        </Clause>

        <Clause title="7. Your data">
          Your account, profile, diary, library, and chat history are stored securely and are
          visible only to you. You can delete your health data or your entire account at any time
          from Settings. Deleting your account removes your data permanently and cannot be undone.
        </Clause>

        <Clause title="8. Availability">
          The service is provided &ldquo;as is&rdquo; and &ldquo;as available&rdquo;, without
          warranties of any kind. Features may change or stop working, and AI features depend on
          third-party services that have their own limits and may be unavailable.
        </Clause>

        <Clause title="9. Limitation of liability">
          To the fullest extent permitted by law, the developer of NutriPilot is not liable for any
          loss, injury, illness, or damage — direct or indirect — arising from your use of the app
          or reliance on any information it provides. Nothing in these terms limits liability that
          cannot lawfully be limited, including for death or personal injury caused by negligence,
          or for fraud.
        </Clause>

        <Clause title="10. Changes">
          These terms may be updated. Continuing to use NutriPilot after an update means you accept
          the revised terms.
        </Clause>

        <p className="rounded-xl bg-muted p-3.5 text-[12px]">
          By creating an account you confirm you are at least 16 years old and that you have read
          and agree to these terms.
        </p>
      </div>
    </Sheet>
  );
}

function Clause({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section>
      <h3 className="mb-1.5 text-[13px] font-semibold text-ink">{title}</h3>
      <p>{children}</p>
    </section>
  );
}
