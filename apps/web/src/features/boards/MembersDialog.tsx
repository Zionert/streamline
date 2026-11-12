import { zodResolver } from '@hookform/resolvers/zod';
import {
  ASSIGNABLE_BOARD_ROLES,
  addBoardMemberSchema,
  assignableBoardRoleSchema,
  canLeaveBoard,
  canManageMember,
  hasBoardPermission,
  type AddBoardMemberInput,
  type BoardMember,
  type BoardRole,
} from '@streamline/shared';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { useNavigate } from 'react-router';

import { Avatar } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { NativeSelect } from '@/components/ui/native-select';
import { useAuthStore } from '@/stores/auth';
import { useBoardStore } from '@/stores/board';

import { ConfirmDialog } from './ConfirmDialog';
import { RoleBadge } from './badges';
import { getBoardErrorMessage } from './boardErrorMessage';
import { ROLE_LABELS } from './labels';
import { BOARDS_PATH } from './paths';

interface MembersDialogProps {
  boardName: string;
  /** Role of the current user on the board. */
  myRole: BoardRole;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/** Board members: everyone sees the list; managers add, re-role and remove; non-owners can leave. */
export function MembersDialog({ boardName, myRole, open, onOpenChange }: MembersDialogProps) {
  const members = useBoardStore((state) => state.members);
  const leaveBoard = useBoardStore((state) => state.leaveBoard);
  const currentUserId = useAuthStore((state) => state.user?.id);
  const navigate = useNavigate();
  const [isLeaving, setIsLeaving] = useState(false);
  const canManage = hasBoardPermission(myRole, 'members:manage');

  const handleLeave = async () => {
    await leaveBoard();
    await navigate(BOARDS_PATH, { replace: true });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Members</DialogTitle>
          <DialogDescription>People with access to "{boardName}".</DialogDescription>
        </DialogHeader>
        <ul aria-label="Board members" className="grid gap-2">
          {members.map((member) => (
            <MemberRow
              key={member.userId}
              member={member}
              isSelf={member.userId === currentUserId}
              canManage={member.userId !== currentUserId && canManageMember(myRole, member.role)}
            />
          ))}
        </ul>
        {canManage && <AddMemberForm />}
        {canLeaveBoard(myRole) && (
          <div className="border-t pt-4">
            <Button variant="outline" onClick={() => setIsLeaving(true)}>
              Leave board
            </Button>
            <ConfirmDialog
              open={isLeaving}
              onOpenChange={setIsLeaving}
              title={`Leave board "${boardName}"?`}
              description="You will lose access to this board until someone adds you again."
              confirmLabel="Leave board"
              onConfirm={handleLeave}
            />
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

interface MemberRowProps {
  member: BoardMember;
  isSelf: boolean;
  /** Role change and removal; never offered for the owner or for yourself (use "Leave board"). */
  canManage: boolean;
}

function MemberRow({ member, isSelf, canManage }: MemberRowProps) {
  const updateMemberRole = useBoardStore((state) => state.updateMemberRole);
  const removeMember = useBoardStore((state) => state.removeMember);
  const [isPending, setIsPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isRemoving, setIsRemoving] = useState(false);
  const selectId = `member-role-${member.userId}`;

  const run = async (action: () => Promise<unknown>) => {
    setIsPending(true);
    setError(null);
    try {
      await action();
    } catch (actionError) {
      setError(getBoardErrorMessage(actionError));
    } finally {
      setIsPending(false);
    }
  };

  const handleRoleChange = (value: string) => {
    const role = assignableBoardRoleSchema.safeParse(value);
    if (role.success) {
      void run(() => updateMemberRole(member.userId, role.data));
    }
  };

  return (
    <li className="flex flex-col gap-1 rounded-md border p-3">
      <div className="flex items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <Avatar userId={member.userId} name={member.name} aria-hidden="true" />
          <div className="min-w-0">
            <p className="truncate text-sm font-medium">
              {member.name}
              {isSelf && <span className="text-muted-foreground"> (you)</span>}
            </p>
            <p className="truncate text-xs text-muted-foreground">{member.email}</p>
          </div>
        </div>
        {canManage ? (
          <div className="flex shrink-0 items-center gap-2">
            <label htmlFor={selectId} className="sr-only">
              Role of {member.name}
            </label>
            <NativeSelect
              id={selectId}
              className="h-8 w-28"
              value={member.role}
              disabled={isPending}
              onChange={(event) => handleRoleChange(event.target.value)}
            >
              {ASSIGNABLE_BOARD_ROLES.map((role) => (
                <option key={role} value={role}>
                  {ROLE_LABELS[role]}
                </option>
              ))}
            </NativeSelect>
            <Button
              variant="outline"
              size="sm"
              disabled={isPending}
              aria-label={`Remove ${member.name}`}
              onClick={() => setIsRemoving(true)}
            >
              Remove
            </Button>
            <ConfirmDialog
              open={isRemoving}
              onOpenChange={setIsRemoving}
              title={`Remove ${member.name} from the board?`}
              description="They will lose access to this board until someone adds them again."
              confirmLabel="Remove member"
              onConfirm={() => removeMember(member.userId)}
            />
          </div>
        ) : (
          <RoleBadge role={member.role} />
        )}
      </div>
      {error && (
        <p role="alert" className="text-xs text-destructive">
          {error}
        </p>
      )}
    </li>
  );
}

function AddMemberForm() {
  const addMember = useBoardStore((state) => state.addMember);
  const {
    register,
    handleSubmit,
    reset,
    setError,
    formState: { errors, isSubmitting },
  } = useForm({
    resolver: zodResolver(addBoardMemberSchema),
    defaultValues: { email: '', role: 'MEMBER' },
  });

  const onSubmit = async (values: AddBoardMemberInput) => {
    try {
      await addMember(values);
      reset();
    } catch (error) {
      setError('root.server', { message: getBoardErrorMessage(error) });
    }
  };

  return (
    <form
      noValidate
      aria-label="Add member"
      className="grid gap-3 border-t pt-4"
      onSubmit={(event) => void handleSubmit(onSubmit)(event)}
    >
      {errors.root?.server && (
        <p role="alert" className="text-sm text-destructive">
          {errors.root.server.message}
        </p>
      )}
      <div className="grid gap-2">
        <Label htmlFor="member-email">Email</Label>
        <Input
          id="member-email"
          type="email"
          autoComplete="off"
          aria-invalid={errors.email ? true : undefined}
          aria-describedby={errors.email ? 'member-email-error' : undefined}
          {...register('email')}
        />
        {errors.email && (
          <p id="member-email-error" className="text-sm text-destructive">
            {errors.email.message}
          </p>
        )}
      </div>
      <div className="grid gap-2">
        <Label htmlFor="member-role">Role</Label>
        <NativeSelect id="member-role" {...register('role')}>
          {ASSIGNABLE_BOARD_ROLES.map((role) => (
            <option key={role} value={role}>
              {ROLE_LABELS[role]}
            </option>
          ))}
        </NativeSelect>
      </div>
      <Button type="submit" disabled={isSubmitting}>
        Add member
      </Button>
    </form>
  );
}
