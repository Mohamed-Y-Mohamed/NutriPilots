import { Camera, FileText, MessageSquarePlus, ShieldCheck } from "lucide-react";
import type { ReactNode } from "react";
import { Sheet } from "./ui";

/**
 * What the coach can do, how to get a meal out of it, and what happens to your
 * messages.
 *
 * This used to live in Settings, three screens away from the coach itself,
 * which meant the one thing people needed to know — that you get the "add to
 * diary" button by asking for it — was somewhere nobody looks until something
 * has already gone wrong.
 */
export function CoachHelpSheet({ onClose, onOpenTerms }: {
  onClose: () => void;
  onOpenTerms: () => void;
}) {
  return (
    <Sheet
      title="How the coach works"
      description="What it can do, how to log what it suggests, and what happens to your messages."
      onClose={onClose}
    >
      <div className="grid gap-5">
        <Section icon={<MessageSquarePlus size={16} />} title="Getting a meal into your diary">
          <p>
            Any time the coach names a food, a card appears underneath its reply with the
            calories and macros already filled in and a button to add it. You do not have to ask
            for it, and you never need to send a second message just to save something.
          </p>
          <p className="mt-2">
            Every number on that card can be changed before you save. If the portion is wrong, or
            you only ate half, edit it there &mdash; the rest recalculates around it.
          </p>
          <p className="mt-2">
            Nothing is written to your diary until you tap the button. The coach cannot save
            anything by itself, so a reply on its own has changed nothing.
          </p>
        </Section>

        <Section icon={<Camera size={16} />} title="Photographing a meal">
          <p>
            Send a photo and it will work out what is on the plate, estimate the portions and give
            you the same add-to-diary card. Every amount it guessed can be corrected before you
            save it &mdash; and correcting one recalculates the rest.
          </p>
          <p className="mt-2">
            Tell it anything the picture cannot show. &ldquo;Cooked in butter&rdquo; or &ldquo;I
            only ate half&rdquo; changes the answer, and it will believe you over the photo.
          </p>
        </Section>

        <Section icon={<ShieldCheck size={16} />} title="What happens to your messages">
          <p>
            Photos are uploaded only for the moment it takes to analyse them and are deleted
            immediately afterwards. A short text description is kept for 30 days so you can look
            back at what you logged, then removed automatically. Your API access is handled
            entirely on the server &mdash; no keys ever reach this device.
          </p>
        </Section>

        <Section icon={<FileText size={16} />} title="What it is not">
          <p>
            Every number the coach gives you is an estimate and a recommendation, not an
            instruction. It is not a doctor or a dietitian, it has not met you, and it does not
            know what medication you take. Anything it suggests is yours to change &mdash; and
            worth checking with a professional if you have a condition it should be working
            around.
          </p>
          <button
            onClick={onOpenTerms}
            className="mt-3 inline-flex min-h-9 items-center gap-2 text-[13px] font-medium text-brand"
          >
            <FileText size={15} /> Read the Terms of Use &amp; Privacy
          </button>
        </Section>
      </div>
    </Sheet>
  );
}

function Section({
  icon,
  title,
  children,
}: {
  icon: ReactNode;
  title: string;
  children: ReactNode;
}) {
  return (
    <section>
      <h3 className="flex items-center gap-2 text-[13px] font-semibold">
        <span className="grid size-7 shrink-0 place-items-center rounded-lg bg-brand-soft text-brand">
          {icon}
        </span>
        {title}
      </h3>
      <div className="mt-2 text-[13px] leading-relaxed text-ink-muted">{children}</div>
    </section>
  );
}
