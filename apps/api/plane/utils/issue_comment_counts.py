from django.db.models import Count, IntegerField, OuterRef, Subquery, Value
from django.db.models.functions import Coalesce

from plane.db.models import IssueComment


def with_comment_count(queryset):
    """Count live comments on the canonical issue without multiplying board rows."""
    return queryset.annotate(
        comment_count=Coalesce(
            Subquery(
                IssueComment.objects.filter(issue_id=OuterRef("pk"), deleted_at__isnull=True)
                .order_by()
                .values("issue_id")
                .annotate(total=Count("id"))
                .values("total"),
                output_field=IntegerField(),
            ),
            Value(0),
        )
    )
