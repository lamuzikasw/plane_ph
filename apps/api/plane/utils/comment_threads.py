from django.db.models import BooleanField, Case, Exists, OuterRef, Q, Value, When

from plane.db.models import IssueComment, IssueCommentRead


def comments_with_thread_roots(user=None):
    """Include deleted roots only while a live reply needs their position in the feed."""
    comments = IssueComment.all_objects.annotate(
        has_live_replies=Exists(IssueComment.objects.filter(parent_id=OuterRef("pk")))
    ).filter(Q(deleted_at__isnull=True) | Q(parent__isnull=True, has_live_replies=True))
    if user is not None:
        comments = comments.annotate(
            is_unread=Case(
                When(
                    Q(parent__isnull=False, deleted_at__isnull=True)
                    & ~Q(actor_id=user.pk)
                    & ~Exists(IssueCommentRead.objects.filter(comment_id=OuterRef("pk"), user=user)),
                    then=Value(True),
                ),
                default=Value(False),
                output_field=BooleanField(),
            )
        )
    return comments
