from app.core.config import settings
from app.core.database import db
from app.models.schemas import ScanJob, ScanJobsResponse, ScanRequest, ScanResponse


async def enqueue_scan(req: ScanRequest) -> ScanResponse:
    """Queue discover/macsuck/arpnip jobs directly in Netdisco's PostgreSQL admin queue."""
    if settings.mock_mode:
        from app.services.mock_data import enqueue_mock_scan

        return enqueue_mock_scan(req)

    queued_jobs: list[ScanJob] = []
    for action in req.actions:
        row = await db.execute_returning(
            """
            INSERT INTO admin (entered, device, action, subaction, status, username, userip)
            VALUES (NOW(), %s::inet, %s, NULL, 'queued', %s, '127.0.0.1'::inet)
            RETURNING
                job,
                host(device) AS device,
                action,
                subaction,
                status,
                entered,
                started,
                finished,
                username,
                log
            """,
            (req.target_ip, action, req.requested_by),
        )
        if row is not None:
            queued_jobs.append(
                ScanJob(
                    job_id=int(row["job"]),
                    device=row.get("device"),
                    action=row["action"],
                    subaction=row.get("subaction"),
                    status=row["status"],
                    entered=row.get("entered"),
                    started=row.get("started"),
                    finished=row.get("finished"),
                    username=row.get("username"),
                    log=row.get("log"),
                )
            )

    return ScanResponse(
        queued_jobs=queued_jobs,
        message=f"Queued {len(queued_jobs)} Netdisco job(s) for {req.target_ip}.",
        mode="live",
    )


async def list_scan_jobs(limit: int = 50) -> ScanJobsResponse:
    """Return recent jobs from Netdisco's admin queue table."""
    safe_limit = max(1, min(limit, 200))
    if settings.mock_mode:
        from app.services.mock_data import list_mock_jobs

        return list_mock_jobs(limit=safe_limit)

    rows = await db.fetch_all(
        """
        SELECT
            job,
            host(device) AS device,
            action,
            subaction,
            status,
            entered,
            started,
            finished,
            username,
            log
        FROM admin
        ORDER BY entered DESC NULLS LAST, job DESC
        LIMIT %s
        """,
        (safe_limit,),
    )

    jobs = [
        ScanJob(
            job_id=int(row["job"]),
            device=row.get("device"),
            action=row["action"],
            subaction=row.get("subaction"),
            status=row.get("status") or "unknown",
            entered=row.get("entered"),
            started=row.get("started"),
            finished=row.get("finished"),
            username=row.get("username"),
            log=row.get("log"),
        )
        for row in rows
    ]
    return ScanJobsResponse(jobs=jobs, total=len(jobs), mode="live")
