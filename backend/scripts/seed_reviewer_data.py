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
        user.name = "Alex Rivera"
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

        profile.full_name = "Alex Rivera"
        profile.email = REVIEWER_EMAIL
        profile.phone = "+1 (555) 234-5678"
        profile.location = "San Francisco, CA"
        profile.linkedin_url = "https://linkedin.com/in/alex-rivera-tech"
        profile.github_url = "https://github.com/alexrivera-dev"
        profile.portfolio_url = "https://alexrivera.dev"
        profile.subtitle = "Staff Software Engineer | Distributed Systems & Cloud Platforms"
        profile.summary = (
            "Staff Software Engineer with 8+ years of experience designing and scaling low-latency distributed systems, "
            "cloud-native backend services, and developer platforms. Track record of improving system throughput by 4x, "
            "reducing cloud infrastructure costs by 35%, and leading engineering teams through high-velocity product launches "
            "across AWS and Kubernetes environments."
        )
        profile.skills = [
            "Go",
            "Python",
            "TypeScript",
            "Rust",
            "FastAPI",
            "React",
            "Next.js",
            "Node.js",
            "Docker",
            "Kubernetes",
            "AWS (ECS, EKS, RDS, S3, CloudFront)",
            "PostgreSQL",
            "Redis",
            "Kafka",
            "gRPC",
            "GraphQL",
            "Terraform",
            "CI/CD (GitHub Actions)",
            "Prometheus",
            "Grafana",
            "System Architecture",
            "ATS Optimization",
            "Distributed Systems",
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
                role="Staff Software Engineer",
                organization="Stripe",
                location="San Francisco, CA",
                start_date=date(2022, 3, 1),
                end_date=None,
                bullet_points=[
                    "Architected real-time transaction processing pipeline in Go handling 12,000+ RPS with p99 latency under 28ms across multi-region active-active clusters.",
                    "Designed and deployed automated database failover across AWS us-east-1 and us-west-2, elevating payment network availability to 99.999%.",
                    "Led a cross-functional team of 7 senior engineers executing zero-downtime database schema migration across 150M+ customer payment records.",
                    "Spearheaded infrastructure cost-optimization initiative transitioning EC2 fleets to AWS Graviton3, slashing cloud expenditure by $420k annually.",
                ],
                sort_order=1,
                source="manual",
            ),
            UserExperience(
                user_id=user_id,
                role="Senior Backend Engineer",
                organization="DoorDash",
                location="San Francisco, CA",
                start_date=date(2019, 6, 1),
                end_date=date(2022, 2, 28),
                bullet_points=[
                    "Built real-time dispatch and routing microservices in Python (FastAPI), Kafka, and Redis caching serving 4M+ daily active delivery orders.",
                    "Implemented predictive ETA scoring ML inference pipeline cutting driver idle time by 18% and increasing on-time fulfillment to 94.2%.",
                    "Authored internal developer CLI and automated GitHub Actions CI/CD workflows, shortening average pull request deploy turnaround from 45 min to 9 min.",
                    "Mentored 5 engineers and established core reliability & API design guidelines adopted by 40+ engineering squads.",
                ],
                sort_order=2,
                source="manual",
            ),
            UserExperience(
                user_id=user_id,
                role="Software Engineer",
                organization="Twilio",
                location="San Francisco, CA",
                start_date=date(2017, 8, 1),
                end_date=date(2019, 5, 31),
                bullet_points=[
                    "Developed high-throughput voice and messaging delivery services in Node.js and Go processing over 250M monthly webhook dispatches.",
                    "Optimized PostgreSQL partitioning and index strategy, eliminating lock contention and reducing slow query occurrences by 65%.",
                    "Implemented automated synthetic canary monitoring in Datadog and PagerDuty, lowering mean-time-to-detection (MTTD) by 40%.",
                ],
                sort_order=3,
                source="manual",
            ),
            UserExperience(
                user_id=user_id,
                role="Software Engineering Intern",
                organization="Mozilla",
                location="Mountain View, CA",
                start_date=date(2016, 5, 1),
                end_date=date(2016, 8, 31),
                bullet_points=[
                    "Contributed C++ and Rust optimizations to Firefox networking engine, improving DOM page rendering speed by 7% on low-memory mobile devices.",
                    "Authored 80+ automated unit and integration tests achieving 92% test coverage on core HTTP/2 protocol parser.",
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
                name="CloudScale — Distributed Cache & Key-Value Store",
                description="High-throughput distributed in-memory key-value engine with Raft consensus and linearizable storage.",
                technologies=["Go", "Raft", "gRPC", "Docker", "Prometheus"],
                github_url="https://github.com/alexrivera-dev/cloudscale",
                live_url="https://cloudscale.alexrivera.dev",
                start_date=date(2023, 1, 1),
                end_date=date(2023, 8, 1),
                bullet_points=[
                    "Engineered distributed key-value store using Raft consensus in Go, supporting linearizable reads and atomic transactional writes.",
                    "Achieved 85,000 writes/sec sustained throughput with sub-millisecond network hops over gRPC and memory-mapped ring buffers.",
                    "Published open-source library featured on Hacker News front page, accumulating 3,400+ GitHub stars.",
                ],
                sort_order=1,
                source="manual",
            ),
            UserProject(
                user_id=user_id,
                name="ResumeEngine — ATS Resume Compiler & Layout Analyzer",
                description="Deterministic resume generation and single-page constraint compiler with typography orphan detection.",
                technologies=["Python", "FastAPI", "PostgreSQL", "Next.js", "Docker"],
                github_url="https://github.com/alexrivera-dev/resume-engine",
                live_url="https://resume-engine.demo.app",
                start_date=date(2024, 2, 1),
                end_date=date(2024, 9, 1),
                bullet_points=[
                    "Engineered automated resume compilation pipeline converting structured JSON into single-page PDF artifacts with WeasyPrint.",
                    "Implemented font-size binary search algorithm guaranteeing 100% single-page constraint satisfaction without text clipping.",
                    "Integrated real-time typography orphan detection identifying trailing single-word line wraps.",
                ],
                sort_order=2,
                source="manual",
            ),
            UserProject(
                user_id=user_id,
                name="EventStream — Real-Time WebSocket Analytics Hub",
                description="High-velocity event streaming and analytics dashboard with sub-second ingestion latency.",
                technologies=["TypeScript", "React", "Kafka", "ClickHouse", "Tailwind CSS"],
                github_url="https://github.com/alexrivera-dev/eventstream",
                live_url="https://eventstream.alexrivera.dev",
                start_date=date(2023, 9, 1),
                end_date=date(2024, 1, 15),
                bullet_points=[
                    "Developed real-time observability dashboard processing 50k events/sec with sub-second ingestion latency using ClickHouse.",
                    "Engineered responsive React canvas charting interface rendering 100,000+ data points smoothly at 60 FPS.",
                ],
                sort_order=3,
                source="manual",
            ),
            UserProject(
                user_id=user_id,
                name="AuthGate — Lightweight OAuth 2.1 & PKCE Gateway",
                description="RFC 8414 and RFC 7636 compliant authorization server with PKCE and dynamic client registration.",
                technologies=["Python", "OAuth 2.1", "Redis", "JWT", "PostgreSQL"],
                github_url="https://github.com/alexrivera-dev/authgate",
                live_url="https://authgate.demo.app",
                start_date=date(2024, 6, 1),
                end_date=date(2024, 10, 1),
                bullet_points=[
                    "Created RFC 8414 and RFC 7636 compliant OAuth 2.1 authorization server with PKCE (S256) and dynamic client registration.",
                    "Secured token issuance with rotating refresh token families, preventing replay and session hijacking attacks.",
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
                institution="University of California, Berkeley",
                degree="Bachelor of Science in Computer Science",
                location="Berkeley, CA",
                start_date=date(2013, 9, 1),
                end_date=date(2017, 5, 15),
                gpa="3.88 / 4.0",
                coursework=[
                    "Distributed Systems",
                    "Operating Systems",
                    "Algorithms & Complexity",
                    "Database Systems",
                    "Computer Networking",
                    "Artificial Intelligence",
                ],
                sort_order=1,
            ),
            UserEducation(
                user_id=user_id,
                institution="Stanford University (Continuing Studies)",
                degree="Graduate Certificate in Cloud Architecture & Scalable Systems",
                location="Stanford, CA",
                start_date=date(2018, 9, 1),
                end_date=date(2019, 6, 15),
                gpa=None,
                coursework=[
                    "Cloud Native Engineering",
                    "High Performance Computing",
                    "Advanced Distributed Storage",
                ],
                sort_order=2,
            ),
        ]
        session.add_all(education)

        # 7. Insert Extracurriculars
        extracurriculars = [
            UserExtracurricular(
                user_id=user_id,
                title="Open Source Maintainer & Contributor",
                organization="CNCF & Open Source Community",
                description="Active contributor to Go and cloud-native projects with over 5,000 GitHub contributions.",
                start_date=date(2020, 1, 1),
                end_date=None,
                bullet_points=[
                    "Co-maintainer of popular Go caching utilities downloaded 1.2M+ times monthly.",
                    "Regular speaker at Bay Area Go and Kubernetes meetups on distributed consensus and high-throughput microservices.",
                ],
                sort_order=1,
            ),
            UserExtracurricular(
                user_id=user_id,
                title="Hackathon Mentor & Technical Judge",
                organization="CalHacks (UC Berkeley)",
                description="Mentored student development teams on scalable system design.",
                start_date=date(2021, 10, 1),
                end_date=None,
                bullet_points=[
                    "Mentored 120+ collegiate student developers on full-stack architecture, deployment pipelines, and database optimization.",
                ],
                sort_order=2,
            ),
        ]
        session.add_all(extracurriculars)

        # 8. Insert Completed Sample Generations
        now_dt = datetime.now(timezone.utc)
        tailored_resume_1 = {
            "header": {
                "name": "Alex Rivera",
                "email": REVIEWER_EMAIL,
                "phone": "+1 (555) 234-5678",
                "location": "San Francisco, CA",
                "linkedin": "https://linkedin.com/in/alex-rivera-tech",
                "github": "https://github.com/alexrivera-dev",
                "website": "https://alexrivera.dev",
            },
            "summary": (
                "Staff Software Engineer with 8+ years building high-throughput distributed systems and payment platforms. "
                "Proven track record scaling transaction pipelines to 12,000+ RPS and delivering 99.999% SLA across multi-region AWS environments."
            ),
            "skills": {
                "Languages": ["Go", "Python", "TypeScript", "Rust", "SQL"],
                "Cloud & Infrastructure": ["AWS (ECS, EKS, RDS, S3)", "Docker", "Kubernetes", "Terraform", "CI/CD"],
                "Distributed Systems": ["Kafka", "Redis", "gRPC", "PostgreSQL", "Raft Consensus", "Prometheus"],
            },
            "experiences": [
                {
                    "company": "Stripe",
                    "role": "Staff Software Engineer",
                    "location": "San Francisco, CA",
                    "start_date": "Mar 2022",
                    "end_date": "Present",
                    "bullet_points": [
                        "Architected real-time transaction processing pipeline in Go handling 12,000+ RPS with p99 latency under 28ms across active-active clusters.",
                        "Designed and deployed automated database failover across AWS us-east-1 and us-west-2, elevating payment network availability to 99.999%.",
                        "Led cross-functional team of 7 senior engineers executing zero-downtime database migration across 150M+ customer payment records.",
                        "Spearheaded infrastructure cost-optimization initiative transitioning EC2 fleets to Graviton3, slashing cloud spend by $420k annually.",
                    ],
                },
                {
                    "company": "DoorDash",
                    "role": "Senior Backend Engineer",
                    "location": "San Francisco, CA",
                    "start_date": "Jun 2019",
                    "end_date": "Feb 2022",
                    "bullet_points": [
                        "Built real-time dispatch and routing microservices in Python (FastAPI), Kafka, and Redis caching serving 4M+ daily active delivery orders.",
                        "Implemented predictive ETA scoring ML inference pipeline cutting driver idle time by 18% and boosting on-time fulfillment to 94.2%.",
                        "Authored internal developer CLI and automated GitHub Actions CI/CD workflows, shortening average PR deploy turnaround from 45 min to 9 min.",
                    ],
                },
                {
                    "company": "Twilio",
                    "role": "Software Engineer",
                    "location": "San Francisco, CA",
                    "start_date": "Aug 2017",
                    "end_date": "May 2019",
                    "bullet_points": [
                        "Developed high-throughput voice and messaging delivery services in Node.js and Go processing over 250M monthly webhook dispatches.",
                        "Optimized PostgreSQL partitioning and index strategy, eliminating lock contention and reducing slow query occurrences by 65%.",
                    ],
                },
            ],
            "projects": [
                {
                    "name": "CloudScale — Distributed Cache & Key-Value Store",
                    "role": "Creator & Lead Architect",
                    "start_date": "Jan 2023",
                    "end_date": "Aug 2023",
                    "github_url": "https://github.com/alexrivera-dev/cloudscale",
                    "bullet_points": [
                        "Engineered distributed key-value store using Raft consensus in Go, supporting linearizable reads and atomic transactional writes.",
                        "Achieved 85,000 writes/sec sustained throughput with sub-millisecond network hops over gRPC and memory-mapped ring buffers.",
                        "Published open-source library featured on Hacker News front page with 3,400+ GitHub stars.",
                    ],
                },
                {
                    "name": "ResumeEngine — ATS Resume Compiler",
                    "role": "Creator",
                    "start_date": "Feb 2024",
                    "end_date": "Sep 2024",
                    "github_url": "https://github.com/alexrivera-dev/resume-engine",
                    "bullet_points": [
                        "Engineered automated resume compilation pipeline converting structured JSON into single-page PDF artifacts with WeasyPrint.",
                        "Implemented font-size binary search algorithm guaranteeing 100% single-page constraint satisfaction without text clipping.",
                    ],
                },
            ],
            "education": [
                {
                    "institution": "University of California, Berkeley",
                    "degree": "B.S. in Computer Science",
                    "location": "Berkeley, CA",
                    "start_date": "Sep 2013",
                    "end_date": "May 2017",
                    "gpa": "3.88 / 4.0",
                    "bullet_points": [
                        "Coursework: Distributed Systems, Operating Systems, Algorithms & Complexity, Database Systems, Computer Networking",
                    ],
                }
            ],
            "extracurriculars": [
                {
                    "title": "Open Source Maintainer & Contributor",
                    "organization": "CNCF Community",
                    "start_date": "Jan 2020",
                    "end_date": "Present",
                    "bullet_points": [
                        "Co-maintainer of popular Go caching utilities downloaded 1.2M+ times monthly.",
                    ],
                }
            ],
        }

        gen1 = Generation(
            user_id=user_id,
            template_id="personal-classic",
            job_title="Staff Distributed Systems Engineer",
            company="Stripe",
            job_description=(
                "We are looking for a Staff Distributed Systems Engineer to design, scale, and optimize Stripe's core global "
                "transaction routing engine. You will work with Go, Kafka, AWS, and low-latency storage engines to deliver "
                "five-nines reliability."
            ),
            keywords=["Go", "Distributed Systems", "Kafka", "AWS", "High Throughput", "Low Latency", "Raft", "Multi-region"],
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
        print(f"Successfully seeded comprehensive reviewer data for {REVIEWER_EMAIL} (user_id: {user_id})!")


if __name__ == "__main__":
    asyncio.run(seed())
