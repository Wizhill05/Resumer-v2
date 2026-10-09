import asyncio
import json
import uuid
from datetime import date, datetime, timezone
from sqlalchemy import select, delete
from src.core.database import AsyncSessionLocal
from src.models.user import User
from src.models.profile import Profile, UserProject, UserExperience, UserEducation, UserExtracurricular
from src.models.generation import Generation

REVIEWER_EMAIL = "reviewer@resumer.test"


async def seed():
    async with AsyncSessionLocal() as session:
        # 1. Fetch user
        res = await session.execute(select(User).where(User.email == REVIEWER_EMAIL))
        user = res.scalar_one_or_none()
        if not user:
            print(f"Error: User {REVIEWER_EMAIL} not found!")
            return

        user_id = user.id
        user.name = "Sam Altman"
        user.first_generation_completed = True
        user.preferred_creativity_mode = "larp"
        user.preferred_projects = 3
        user.preferred_experience = 3

        # 2. Upsert Profile
        res = await session.execute(select(Profile).where(Profile.user_id == user_id))
        profile = res.scalar_one_or_none()
        if not profile:
            profile = Profile(user_id=user_id)
            session.add(profile)

        profile.full_name = "Sam Altman"
        profile.email = REVIEWER_EMAIL
        profile.phone = "+1 (415) 867-5309"
        profile.location = "San Francisco, CA"
        profile.linkedin_url = "https://linkedin.com/in/samaltman"
        profile.github_url = "https://github.com/sama"
        profile.portfolio_url = "https://blog.samaltman.com"
        profile.subtitle = "CEO @ OpenAI | Former President @ Y Combinator | Technologist & Investor"
        profile.summary = (
            "Co-Founder & CEO of OpenAI, leading the research, scaling, and commercial deployment of frontier artificial "
            "intelligence systems including GPT-4, o1, and ChatGPT. Former President of Y Combinator, backing and scaling "
            "transformative companies including Airbnb, Stripe, Dropbox, and Reddit. Passionate about supercomputing, "
            "clean fusion energy, and ensuring artificial general intelligence benefits all of humanity."
        )
        profile.skills = [
            "Artificial General Intelligence",
            "Frontier Model Scaling",
            "Executive Leadership",
            "Product Strategy",
            "Supercomputing Infrastructure",
            "AI Safety & Governance",
            "Venture Capital & Investing",
            "Startup Acceleration",
            "Capital Allocation",
            "Nuclear & Fusion Energy",
            "Distributed Compute",
            "Board Governance",
            "Reinforcement Learning (RLHF)",
            "Zero-Knowledge Cryptography",
            "Public Policy & Senate Testimony",
        ]

        # 3. Clean up existing records for fresh idempotent seed
        await session.execute(delete(UserExperience).where(UserExperience.user_id == user_id))
        await session.execute(delete(UserProject).where(UserProject.user_id == user_id))
        await session.execute(delete(UserEducation).where(UserEducation.user_id == user_id))
        await session.execute(delete(UserExtracurricular).where(UserExtracurricular.user_id == user_id))
        await session.execute(delete(Generation).where(Generation.user_id == user_id))

        # 4. Insert Work Experiences
        experiences = [
            UserExperience(
                user_id=user_id,
                role="Chief Executive Officer & Co-Founder",
                organization="OpenAI",
                location="San Francisco, CA",
                start_date=date(2019, 3, 1),
                end_date=None,
                bullet_points=[
                    "Scaled OpenAI into the world's leading frontier AI lab, creating ChatGPT which reached 100M+ weekly active users faster than any product in internet history.",
                    "Spearheaded research and multi-modal product roadmap delivering GPT-3, GPT-4, DALL·E, Sora, and reasoning models (o1 series).",
                    "Orchestrated landmark strategic partnerships and capital raises totaling over $13B with Microsoft, Oracle, and global institutional partners to secure multi-gigawatt compute capacity.",
                    "Represented the AI industry in global policy dialogues, testifying before the US Senate and advising G7 leaders on AI safety standards and democratic access.",
                ],
                sort_order=1,
                source="manual",
            ),
            UserExperience(
                user_id=user_id,
                role="President",
                organization="Y Combinator",
                location="Mountain View & San Francisco, CA",
                start_date=date(2014, 2, 1),
                end_date=date(2019, 3, 1),
                bullet_points=[
                    "Led the world's preeminent startup accelerator, expanding the combined portfolio valuation to over $150B across companies like Stripe, Airbnb, DoorDash, Cruise, and Coinbase.",
                    "Founded YC Research to fund non-profit open research on long-term breakthrough technologies, directly incubating OpenAI, Basic Income Project, and HARC.",
                    "Created YC Continuity, a $1B growth-stage investment fund supporting alumni companies through late-stage rounds and IPOs.",
                    "Launched YC Fellowship and Startup School, democratizing access to startup education for hundreds of thousands of founders worldwide.",
                ],
                sort_order=2,
                source="manual",
            ),
            UserExperience(
                user_id=user_id,
                role="Partner",
                organization="Y Combinator",
                location="Mountain View, CA",
                start_date=date(2011, 10, 1),
                end_date=date(2014, 2, 1),
                bullet_points=[
                    "Mentored hundreds of early-stage founders on product-market fit, viral distribution, business model design, and fundraising.",
                    "Served as lead partner for dozens of breakout technology companies, negotiating terms and advising executive teams through hypergrowth.",
                ],
                sort_order=3,
                source="manual",
            ),
            UserExperience(
                user_id=user_id,
                role="Co-Founder & CEO",
                organization="Loopt",
                location="Mountain View, CA",
                start_date=date(2005, 6, 1),
                end_date=date(2012, 3, 1),
                bullet_points=[
                    "Co-founded pioneering mobile location-sharing network as part of Y Combinator's inaugural Summer 2005 batch.",
                    "Secured direct carrier distribution deals with Sprint Nextel, Verizon, and AT&T, scaling to millions of mobile users.",
                    "Successfully led company through acquisition by Green Dot Corporation for $43.4M in 2012.",
                ],
                sort_order=4,
                source="manual",
            ),
        ]
        session.add_all(experiences)

        # 5. Insert Projects
        projects = [
            UserProject(
                user_id=user_id,
                name="ChatGPT & Frontier LLM Ecosystem",
                description="The fastest-growing consumer application in internet history, delivering conversational intelligence to 200M+ users.",
                technologies=["Frontier AI", "Transformers", "RLHF", "Distributed Compute", "Supercomputing Clusters"],
                github_url="https://github.com/openai",
                live_url="https://chatgpt.com",
                start_date=date(2022, 1, 1),
                end_date=None,
                bullet_points=[
                    "Guided architecture, safety alignment, and launch of ChatGPT, achieving 100M active users within 60 days of release.",
                    "Built global enterprise and developer API ecosystem powering over 3M developers and 92% of Fortune 500 companies.",
                    "Pioneered Reinforcement Learning from Human Feedback (RLHF) and frontier model system prompt design.",
                ],
                sort_order=1,
                source="manual",
            ),
            UserProject(
                user_id=user_id,
                name="Worldcoin (World Network) — Proof of Personhood Protocol",
                description="Decentralized open-source identity and financial network designed to preserve human uniqueness in an AI era.",
                technologies=["Zero-Knowledge Proofs", "Biometrics", "Ethereum", "Optimism", "Privacy Protocols"],
                github_url="https://github.com/worldcoin",
                live_url="https://world.org",
                start_date=date(2020, 6, 1),
                end_date=None,
                bullet_points=[
                    "Co-founded global proof-of-personhood protocol using zero-knowledge iris cryptography to separate human intelligence from AI bots.",
                    "Scaled network to over 10M verified humans across 160+ countries while maintaining complete cryptographic privacy.",
                ],
                sort_order=2,
                source="manual",
            ),
            UserProject(
                user_id=user_id,
                name="Helion Energy — Commercial Clean Fusion Power",
                description="Magneto-inertial fusion company building zero-carbon baseload energy for next-generation compute.",
                technologies=["Plasma Physics", "Magnetic Compression", "Clean Energy", "Power Grid Infrastructure"],
                github_url=None,
                live_url="https://helionenergy.com",
                start_date=date(2021, 1, 1),
                end_date=None,
                bullet_points=[
                    "Lead investor and Chairman backing commercial fusion energy generator, closing first private fusion power purchase agreement with Microsoft for 50MW+ by 2028.",
                    "Secured regulatory framework and advanced prototype testing demonstrating net electricity recovery from pulsed magnetic fusion.",
                ],
                sort_order=3,
                source="manual",
            ),
            UserProject(
                user_id=user_id,
                name="Oklo — Advanced Nuclear Fast Fission Microreactors",
                description="Clean nuclear microreactor technology delivering distributed zero-carbon power.",
                technologies=["Fast Fission", "Liquid Metal Coolant", "Nuclear Engineering", "Micro-reactors"],
                github_url=None,
                live_url="https://oklo.com",
                start_date=date(2020, 1, 1),
                end_date=None,
                bullet_points=[
                    "Chairman leading deployment of small modular nuclear fission reactors fueled by recycled nuclear waste.",
                    "Guided successful public listing on the New York Stock Exchange (NYSE: OKLO) to finance multi-site commercial microreactor deployment.",
                ],
                sort_order=4,
                source="manual",
            ),
        ]
        session.add_all(projects)

        # 6. Insert Education
        education = [
            UserEducation(
                user_id=user_id,
                institution="Stanford University",
                degree="Computer Science (Left early to build Loopt & Y Combinator)",
                location="Stanford, CA",
                start_date=date(2003, 9, 1),
                end_date=date(2005, 6, 1),
                gpa=None,
                coursework=[
                    "Artificial Intelligence",
                    "Compiler Optimization",
                    "Algorithms & Data Structures",
                    "Computer Architecture",
                ],
                sort_order=1,
            ),
            UserEducation(
                user_id=user_id,
                institution="John Burroughs School",
                degree="High School Diploma",
                location="St. Louis, MO",
                start_date=date(1999, 9, 1),
                end_date=date(2003, 6, 1),
                gpa=None,
                coursework=[
                    "Mathematics",
                    "Computer Science",
                    "Physics",
                ],
                sort_order=2,
            ),
        ]
        session.add_all(education)

        # 7. Insert Extracurriculars
        extracurriculars = [
            UserExtracurricular(
                user_id=user_id,
                title="AI Safety & Policy Advocacy",
                organization="US Senate & Global AI Safety Summits",
                description="Advised global governments and legislative bodies on frontier AI safety and democratization.",
                start_date=date(2023, 5, 1),
                end_date=None,
                bullet_points=[
                    "Testified before the US Senate Judiciary Subcommittee on Artificial Intelligence, proposing independent auditing and safety licensing frameworks.",
                    "Co-developed voluntary commitments with the White House and international safety institutes for pre-deployment frontier evaluations.",
                ],
                sort_order=1,
            ),
            UserExtracurricular(
                user_id=user_id,
                title="Angel Investing & Philanthropy",
                organization="Hydrazine Capital & Personal Portfolio",
                description="Early seed investor backing generational technology founders.",
                start_date=date(2010, 1, 1),
                end_date=None,
                bullet_points=[
                    "Early-stage backer of 40+ category-defining tech companies including Stripe, Reddit, Pinterest, Airbnb, and Asana.",
                    "Served on the Board of Directors for Reddit and spearheaded early public goods philanthropy initiatives.",
                ],
                sort_order=2,
            ),
        ]
        session.add_all(extracurriculars)

        # 8. Insert Completed Sample Generation
        now_dt = datetime.now(timezone.utc)
        tailored_resume_1 = {
            "header": {
                "name": "Sam Altman",
                "email": REVIEWER_EMAIL,
                "phone": "+1 (415) 867-5309",
                "location": "San Francisco, CA",
                "linkedin": "https://linkedin.com/in/samaltman",
                "github": "https://github.com/sama",
                "website": "https://blog.samaltman.com",
            },
            "summary": (
                "Co-Founder & CEO of OpenAI with 15+ years scaling transformative technology companies from inception to global impact. "
                "Architected product and commercialization strategy for ChatGPT and frontier LLMs, partnered with hyperscalers for multi-gigawatt compute, "
                "and championed global AI governance to ensure AGI benefits humanity."
            ),
            "skills": {
                "Executive Leadership": ["Frontier Model Scaling", "Product Strategy", "Capital Allocation", "Board Governance", "Public Policy"],
                "Technology & Infrastructure": ["Supercomputing Clusters", "Distributed Compute", "Clean Fusion & Nuclear Energy", "Zero-Knowledge Proofs"],
                "Venture & Ecosystem": ["Startup Acceleration", "Venture Capital", "Hyperscaler Partnerships", "Developer Platforms"],
            },
            "experiences": [
                {
                    "company": "OpenAI",
                    "role": "Chief Executive Officer & Co-Founder",
                    "location": "San Francisco, CA",
                    "start_date": "Mar 2019",
                    "end_date": "Present",
                    "bullet_points": [
                        "Scaled OpenAI into the world's leading frontier AI lab, creating ChatGPT which reached 100M+ weekly active users faster than any product in internet history.",
                        "Spearheaded research and multi-modal product roadmap delivering GPT-3, GPT-4, DALL·E, Sora, and reasoning models (o1 series).",
                        "Orchestrated landmark strategic partnerships and capital raises totaling over $13B with Microsoft, Oracle, and global institutional partners to secure multi-gigawatt compute capacity.",
                        "Represented the AI industry in global policy dialogues, testifying before the US Senate and advising G7 leaders on AI safety standards and democratic access.",
                    ],
                },
                {
                    "company": "Y Combinator",
                    "role": "President",
                    "location": "Mountain View, CA",
                    "start_date": "Feb 2014",
                    "end_date": "Mar 2019",
                    "bullet_points": [
                        "Led the world's preeminent startup accelerator, expanding the combined portfolio valuation to over $150B across companies like Stripe, Airbnb, DoorDash, Cruise, and Coinbase.",
                        "Founded YC Research to fund non-profit open research on long-term breakthrough technologies, directly incubating OpenAI, Basic Income Project, and HARC.",
                        "Created YC Continuity, a $1B growth-stage investment fund supporting alumni companies through late-stage rounds and IPOs.",
                    ],
                },
                {
                    "company": "Loopt",
                    "role": "Co-Founder & CEO",
                    "location": "Mountain View, CA",
                    "start_date": "Jun 2005",
                    "end_date": "Mar 2012",
                    "bullet_points": [
                        "Co-founded pioneering mobile location-sharing network as part of Y Combinator's inaugural Summer 2005 batch.",
                        "Secured direct carrier distribution deals with Sprint Nextel, Verizon, and AT&T, scaling to millions of mobile users.",
                        "Successfully led company through acquisition by Green Dot Corporation for $43.4M in 2012.",
                    ],
                },
            ],
            "projects": [
                {
                    "name": "ChatGPT & Frontier LLM Ecosystem",
                    "role": "Co-Founder & CEO",
                    "start_date": "Jan 2022",
                    "end_date": "Present",
                    "live_url": "https://chatgpt.com",
                    "bullet_points": [
                        "Guided architecture, safety alignment, and launch of ChatGPT, achieving 100M active users within 60 days of release.",
                        "Built global enterprise and developer API ecosystem powering over 3M developers and 92% of Fortune 500 companies.",
                    ],
                },
                {
                    "name": "Worldcoin (World Network)",
                    "role": "Co-Founder",
                    "start_date": "Jun 2020",
                    "end_date": "Present",
                    "live_url": "https://world.org",
                    "bullet_points": [
                        "Co-founded global proof-of-personhood protocol using zero-knowledge iris cryptography to separate human intelligence from AI bots.",
                        "Scaled network to over 10M verified humans across 160+ countries while maintaining complete cryptographic privacy.",
                    ],
                },
                {
                    "name": "Helion Energy",
                    "role": "Chairman & Lead Investor",
                    "start_date": "Jan 2021",
                    "end_date": "Present",
                    "live_url": "https://helionenergy.com",
                    "bullet_points": [
                        "Lead investor and Chairman backing commercial fusion energy generator, closing first private fusion power purchase agreement with Microsoft for 50MW+ by 2028.",
                    ],
                },
            ],
            "education": [
                {
                    "institution": "Stanford University",
                    "degree": "Computer Science (Left early to build Loopt & YC)",
                    "location": "Stanford, CA",
                    "start_date": "Sep 2003",
                    "end_date": "Jun 2005",
                    "bullet_points": [
                        "Coursework: Artificial Intelligence, Compiler Optimization, Algorithms & Data Structures",
                    ],
                }
            ],
            "extracurriculars": [
                {
                    "title": "AI Safety & Policy Advocacy",
                    "organization": "US Senate & Global AI Summits",
                    "start_date": "May 2023",
                    "end_date": "Present",
                    "bullet_points": [
                        "Testified before the US Senate Judiciary Subcommittee on Artificial Intelligence, proposing independent auditing and safety licensing frameworks.",
                    ],
                }
            ],
        }

        gen1 = Generation(
            user_id=user_id,
            template_id="personal-classic",
            job_title="Chief Executive Officer",
            company="OpenAI",
            job_description=(
                "OpenAI is seeking an executive to lead our mission of ensuring artificial general intelligence benefits all of humanity. "
                "The ideal candidate will have deep expertise in frontier model development, supercomputing partnerships, organization scaling, "
                "and global AI policy."
            ),
            keywords=["AGI", "Frontier AI", "Supercomputing", "Compute Scaling", "Executive Leadership", "AI Safety", "Public Policy"],
            model_used="claude-3.5-sonnet",
            status="completed",
            creativity_mode="larp",
            render_metadata={
                "font_size": "9.5pt",
                "page_count": 1,
                "tailored_resume": tailored_resume_1,
            },
            created_at=now_dt,
            completed_at=now_dt,
        )
        session.add(gen1)

        await session.commit()
        print(f"Successfully seeded Sam Altman reviewer data for {REVIEWER_EMAIL} (user_id: {user_id})!")


if __name__ == "__main__":
    asyncio.run(seed())
