import type { Metadata } from "next";
import { PageHero, Section } from "@/components/PublicSections";
import { ContactForm } from "./ContactForm";

export const metadata: Metadata = { title: "Contact" };

export default function ContactPage() {
  return (
    <div>
      <PageHero eyebrow="Contact" title="Tell us what your office should do." lead="Pilot requests, questions about client onboarding, or a security review — messages land in the admin inbox of the portal." />
      <Section title="Send a message">
        <ContactForm />
      </Section>
    </div>
  );
}
