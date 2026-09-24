/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { useRef, useState } from "react";
import { observer } from "mobx-react";
import { useTranslation } from "@plane/i18n";
// plane imports
import type { EditorRefApi } from "@plane/editor";
import type { TIssueComment, TCommentsOperations } from "@plane/types";
// plane web imports
import { CommentBlock, CommentCardDisplay } from "@/plane-web/components/comments";
// local imports
import { CommentQuickActions } from "../quick-actions";

export type TCommentCard = {
  workspaceSlug: string;
  entityId: string;
  comment: TIssueComment | undefined;
  activityOperations: TCommentsOperations;
  ends: "top" | "bottom" | undefined;
  showAccessSpecifier: boolean;
  showCopyLinkOption: boolean;
  enableReplies: boolean;
  disabled?: boolean;
  projectId?: string;
  onReply?: () => void;
  isReply?: boolean;
};

export const CommentCard = observer(function CommentCard(props: TCommentCard) {
  const {
    workspaceSlug,
    entityId,
    comment,
    activityOperations,
    ends,
    showAccessSpecifier,
    showCopyLinkOption,
    disabled = false,
    projectId,
    enableReplies,
    onReply,
    isReply = false,
  } = props;
  const { t } = useTranslation();
  // states
  const [isEditing, setIsEditing] = useState(false);
  // refs
  const readOnlyEditorRef = useRef<EditorRefApi>(null);
  // derived values
  const workspaceId = comment?.workspace;

  if (!comment || !workspaceId) return null;

  const content = comment.deleted_at ? (
    <div id={`comment-${comment.id}`} className="py-2 text-body-sm-regular text-tertiary">
      {t("issue.comments.deleted")}
    </div>
  ) : (
    <CommentCardDisplay
      activityOperations={activityOperations}
      entityId={entityId}
      comment={comment}
      disabled={disabled}
      projectId={projectId}
      readOnlyEditorRef={readOnlyEditorRef}
      showAccessSpecifier={showAccessSpecifier}
      workspaceId={workspaceId}
      workspaceSlug={workspaceSlug}
      isEditing={isEditing}
      setIsEditing={setIsEditing}
      renderQuickActions={() => (
        <CommentQuickActions
          activityOperations={activityOperations}
          comment={comment}
          setEditMode={() => setIsEditing(true)}
          showAccessSpecifier={showAccessSpecifier}
          showCopyLinkOption={showCopyLinkOption}
          onReply={enableReplies && !disabled ? onReply : undefined}
        />
      )}
    />
  );
  return isReply ? (
    <div className="min-w-0 border-b border-subtle py-3 last:border-0">{content}</div>
  ) : (
    <CommentBlock comment={comment} ends={ends}>
      {content}
    </CommentBlock>
  );
});
