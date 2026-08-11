import {
  ArrowRight,
  Bot,
  Camera,
  ChartNoAxesColumnIncreasing,
  CookingPot,
  Salad,
  Search,
  Sparkles,
  type LucideIcon,
} from "lucide-react";
import { type ReactNode } from "react";
import { Link } from "react-router-dom";
import { SiteFooter } from "../components/SiteFooter";
import { SiteHeader } from "../components/SiteHeader";
import { Card, buttonClass, cx } from "../components/ui";
import { useAuth } from "../state/AuthContext";

/** Shared with every section so the page keeps one measure from top to bottom. */
const CONTAINER = "mx-auto w-full max-w-5xl px-4 sm:px-6 lg:px-8";

/**
 * Every claim on this page is one the app can back up. The counts come from the
 * shipped reference data, and each feature below maps to a screen that exists.
 * There is nothing here about pricing, ratings or how many people use it,
 * because none of that is knowable from this repository.
 */
const FEATURES: Array<{
  icon: LucideIcon;
  title: string;
  body: string;
  /** Column span at lg, where the grid becomes a 6-column bento. */
  span: string;
}> = [
  {
    icon: Search,
    title: "A diary that takes seconds",
    body:
      "Search 2,400+ reference foods, set the portion, and file it under breakfast, lunch, dinner or a snack. Calories and macros add themselves up as the day goes on.",
    span: "sm:col-span-2 lg:col-span-3",
  },
  {
    icon: Camera,
    title: "Photograph the plate",
    body:
      "For the meals you did not cook and could not itemise: take a picture and NutriPilot estimates the calories, protein, carbs and fat, ready to log.",
    span: "sm:col-span-2 lg:col-span-3",
  },
  {
    icon: Bot,
    title: "A coach that knows food",
    body:
      "Ask about weight loss, protein, or why the scale has not moved in a fortnight. Answers in plain English, inside the app.",
    span: "lg:col-span-2",
  },
  {
    icon: CookingPot,
    title: "790+ recipes",
    body:
      "Browse the recipe book and change any ingredient's portion. The nutrition recalculates ingredient by ingredient as you adjust it.",
    span: "lg:col-span-2",
  },
  {
    icon: ChartNoAxesColumnIncreasing,
    title: "Targets that fit you",
    body:
      "Height, weight, activity and what you are aiming for become daily calorie and macro targets, measured against everything you log.",
    span: "sm:col-span-2 lg:col-span-2",
  },
];

const STEPS = [
  {
    title: "Set your targets",
    body:
      "Height, weight, how much you move and what you want to change. A minute of answers becomes your daily calories and macros.",
  },
  {
    title: "Log what you ate",
    body:
      "Search a food, open a recipe, or photograph the plate. However you get there, it lands in the same diary.",
  },
  {
    title: "Check in, and ask",
    body:
      "See what is left for the day at a glance, and put the awkward questions to the coach when something is not adding up.",
  },
] as const;

/**
 * The public front door.
 *
 * It renders for signed-in visitors too — people arrive here from bookmarks and
 * shared links long after making an account — so the calls to action point back
 * into the app rather than asking someone to sign up twice.
 */
export function LandingPage() {
  const { user } = useAuth();

  return (
    <div className="min-h-svh bg-canvas text-ink">
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-100 focus:rounded-lg focus:bg-brand focus:px-4 focus:py-2 focus:text-white"
      >
        Skip to content
      </a>

      <SiteHeader />

      <main id="main-content">
        <Hero signedIn={Boolean(user)} />
        <Features />
        <HowItWorks />
        <ClosingCall signedIn={Boolean(user)} />
      </main>

      <SiteFooter />
    </div>
  );
}

/**
 * The primary action changes rather than the whole hero: a returning, signed-in
 * visitor still benefits from being reminded what the app does, they just must
 * not be sent back to a sign-in form they have already been through.
 */
function Hero({ signedIn }: { signedIn: boolean }) {
  return (
    <section className={cx(CONTAINER, "pt-12 pb-14 sm:pt-16 sm:pb-20 lg:pt-20")}>
      <div className="grid items-center gap-10 lg:grid-cols-[1.05fr_0.95fr] lg:gap-14">
        <div className="animate-rise min-w-0">
          {/* brand-strong rather than brand: brand on brand-soft measures 3.3:1
              in the light theme, which is fine behind an icon and not fine
              behind 12px text. brand-strong clears AA in both themes. */}
          <p className="inline-flex items-center gap-2 rounded-full bg-brand-soft px-3 py-1.5 text-xs font-semibold text-brand-strong">
            <Sparkles size={14} aria-hidden="true" />
            Food diary and nutrition coach
          </p>

          <h1 className="mt-5 text-4xl font-semibold leading-[1.05] tracking-tight sm:text-5xl lg:text-[3.5rem]">
            Eat well.
            <br />
            Track simply.
          </h1>

          <p className="mt-5 max-w-lg text-[17px] leading-relaxed text-ink-muted">
            NutriPilot turns what you ate into calories and macros. Search a food, open a recipe,
            or photograph the plate — then ask the coach whenever the numbers need explaining.
          </p>

          <div className="mt-8 flex flex-col gap-3 sm:flex-row sm:items-center">
            <Link
              to={signedIn ? "/today" : "/auth"}
              className={buttonClass("primary", "lg")}
            >
              {signedIn ? "Go to today" : "Get started"}
              <ArrowRight size={17} aria-hidden="true" />
            </Link>

            {/* A plain anchor, not a router Link: this is a jump within the
                current document, so the browser's own hash handling is both
                correct and cheaper than a route change. */}
            <a href="#how-it-works" className={buttonClass("secondary", "lg")}>
              See how it works
            </a>
          </div>

          <p className="mt-6 text-xs leading-relaxed text-ink-muted">
            Estimates are for general guidance, not medical advice.
          </p>
        </div>

        {/* Olive is the app's own dark surface — the sign-in panel and the
            dashboard's coach prompt both use it — so the hero anchors on
            something the product already looks like rather than a stock image. */}
        <div className="animate-rise min-w-0 rounded-3xl bg-olive p-6 sm:p-8">
          <dl className="grid grid-cols-2 gap-4">
            <HeroStat value="2,400+" label="reference foods" />
            <HeroStat value="790+" label="recipes to cook" />
          </dl>

          <ul className="mt-8 grid gap-4 border-t border-white/10 pt-8">
            <HeroPromise icon={<Salad size={17} />}>
              Log real foods and see the day add up
            </HeroPromise>
            <HeroPromise icon={<Camera size={17} />}>
              Photograph a meal for an instant estimate
            </HeroPromise>
            <HeroPromise icon={<Sparkles size={17} />}>
              Ask about weight loss, muscle or plateaus
            </HeroPromise>
          </ul>
        </div>
      </div>
    </section>
  );
}

function HeroStat({ value, label }: { value: string; label: string }) {
  return (
    <div className="min-w-0">
      <dt className="sr-only">{label}</dt>
      <dd>
        <span className="block text-3xl font-semibold tracking-tight tabular-nums text-lime sm:text-4xl">
          {value}
        </span>
        <span className="mt-1 block text-[13px] text-white/60">{label}</span>
      </dd>
    </div>
  );
}

function HeroPromise({ icon, children }: { icon: ReactNode; children: string }) {
  return (
    <li className="flex items-start gap-3 text-[15px] leading-relaxed text-white/75">
      <span aria-hidden="true" className="mt-0.5 shrink-0 text-lime">
        {icon}
      </span>
      <span className="min-w-0">{children}</span>
    </li>
  );
}

function Features() {
  return (
    <section
      aria-labelledby="features-heading"
      className={cx(CONTAINER, "scroll-mt-20 border-t border-line pt-14 pb-14 sm:pt-20 sm:pb-20")}
    >
      <SectionHeading
        id="features-heading"
        eyebrow="What it does"
        title="Five ways to answer one question"
        lead="Everything below is a screen in the app. Whichever route suits the meal in front of you, it ends in the same diary."
      />

      <div className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-6">
        {FEATURES.map(({ icon: Icon, title, body, span }) => (
          <Card key={title} as="article" className={cx("min-w-0 p-5 sm:p-6", span)}>
            <span className="grid size-10 place-items-center rounded-xl bg-brand-soft text-brand">
              <Icon size={19} strokeWidth={1.9} aria-hidden="true" />
            </span>
            <h3 className="mt-4 text-[15px] font-semibold tracking-tight">{title}</h3>
            <p className="mt-2 text-sm leading-relaxed text-ink-muted">{body}</p>
          </Card>
        ))}
      </div>
    </section>
  );
}

function HowItWorks() {
  return (
    <section
      id="how-it-works"
      aria-labelledby="how-it-works-heading"
      className={cx(CONTAINER, "scroll-mt-20 border-t border-line pt-14 pb-14 sm:pt-20 sm:pb-20")}
    >
      <SectionHeading
        id="how-it-works-heading"
        eyebrow="How it works"
        title="Three steps, then it is just habit"
      />

      {/* An ordered list because the order is the point — targets have to exist
          before anything logged against them means very much. */}
      <ol className="mt-10 grid gap-8 sm:grid-cols-3 sm:gap-6">
        {STEPS.map(({ title, body }, index) => (
          <li key={title} className="min-w-0 border-t border-line pt-5">
            <span
              aria-hidden="true"
              className="grid size-9 place-items-center rounded-full bg-olive text-sm font-semibold tabular-nums text-lime"
            >
              {index + 1}
            </span>
            <h3 className="mt-4 text-base font-semibold tracking-tight">{title}</h3>
            <p className="mt-2 text-sm leading-relaxed text-ink-muted">{body}</p>
          </li>
        ))}
      </ol>
    </section>
  );
}

function ClosingCall({ signedIn }: { signedIn: boolean }) {
  return (
    <section aria-labelledby="start-heading" className={cx(CONTAINER, "pb-16 sm:pb-24")}>
      <div className="min-w-0 rounded-3xl bg-olive px-6 py-12 text-center sm:px-10 sm:py-16">
        <h2
          id="start-heading"
          className="mx-auto max-w-xl text-3xl font-semibold leading-tight tracking-tight text-white sm:text-4xl"
        >
          Start with today&rsquo;s lunch
        </h2>
        <p className="mx-auto mt-4 max-w-md text-[15px] leading-relaxed text-white/60">
          One meal is enough to see how it fits. The targets, the recipes and the coach are all
          waiting behind the same account.
        </p>

        <div className="mt-8 flex justify-center">
          <Link to={signedIn ? "/today" : "/auth"} className={buttonClass("lime", "lg")}>
            {signedIn ? "Go to today" : "Create your account"}
            <ArrowRight size={17} aria-hidden="true" />
          </Link>
        </div>
      </div>
    </section>
  );
}

function SectionHeading({
  id,
  eyebrow,
  title,
  lead,
}: {
  id: string;
  eyebrow: string;
  title: string;
  lead?: string;
}) {
  return (
    <div className="max-w-2xl">
      <p className="text-[11px] font-semibold uppercase tracking-wide text-brand-strong">
        {eyebrow}
      </p>
      <h2 id={id} className="mt-2 text-2xl font-semibold tracking-tight sm:text-3xl">
        {title}
      </h2>
      {lead && <p className="mt-3 text-[15px] leading-relaxed text-ink-muted">{lead}</p>}
    </div>
  );
}
