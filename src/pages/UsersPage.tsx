import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription,
} from '@/components/ui/dialog';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Switch } from '@/components/ui/switch';
import { useAuth } from '@/lib/auth';
import { api } from '@/lib/api';
import { safeDate } from '@/lib/types';
import { Loader2, Plus, KeyRound, Trash2, Users } from 'lucide-react';
import { toast } from 'sonner';

// Backend returns snake_case; we accept both shapes defensively
interface UserRecord {
  id: string;
  username: string;
  role?: string;
  is_active?: boolean;
  isActive?: boolean;
  must_change_password?: boolean;
  mustChangePassword?: boolean;
  created_at?: string;
  createdAt?: string;
  updated_at?: string;
  updatedAt?: string;
  last_login_at?: string | null;
  lastLoginAt?: string | null;
}

function isActive(u: UserRecord): boolean {
  return u.is_active ?? u.isActive ?? false;
}
function mustChange(u: UserRecord): boolean {
  return u.must_change_password ?? u.mustChangePassword ?? false;
}
function createdAt(u: UserRecord): string {
  return u.created_at ?? u.createdAt ?? '';
}
function lastLogin(u: UserRecord): string | null {
  return u.last_login_at ?? u.lastLoginAt ?? null;
}

export default function UsersPage() {
  const queryClient = useQueryClient();
  const { user: currentUser } = useAuth();
  const [createOpen, setCreateOpen] = useState(false);
  const [passwordOpen, setPasswordOpen] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null);

  const [newUsername, setNewUsername] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [newPasswordConfirm, setNewPasswordConfirm] = useState('');
  const [newRole, setNewRole] = useState<string>('admin');
  const [mustChangePassword, setMustChangePassword] = useState(true);
  const [changePassword, setChangePassword] = useState('');
  const [changePasswordConfirm, setChangePasswordConfirm] = useState('');

  const { data: users = [], isLoading } = useQuery<UserRecord[]>({
    queryKey: ['users'],
    queryFn: async () => {
      const res = await api.getUsers();
      if (!res.success) return [];
      return Array.isArray(res.data) ? res.data : [];
    },
  });

  const createMutation = useMutation({
    mutationFn: (data: { username: string; password: string; role: string }) => api.createUser(data.username, data.password, mustChangePassword, data.role),
    onSuccess: async (res) => {
      if (res.success) {
        toast.success('Usuário criado com sucesso');
        await queryClient.invalidateQueries({ queryKey: ['users'] });
        await queryClient.refetchQueries({ queryKey: ['users'] });
        setCreateOpen(false);
        setNewUsername('');
        setNewPassword('');
        setNewPasswordConfirm('');
        setNewRole('admin');
        setMustChangePassword(true);
      } else {
        toast.error(res.error || 'Erro ao criar usuário');
      }
    },
  });

  const toggleMutation = useMutation({
    mutationFn: (data: { userId: string; active: boolean }) => api.toggleUser(data.userId, data.active),
    onSuccess: async (res) => {
      if (res.success) {
        toast.success('Status do usuário atualizado');
        await queryClient.invalidateQueries({ queryKey: ['users'] });
        await queryClient.refetchQueries({ queryKey: ['users'] });
      } else {
        toast.error(res.error || 'Erro ao atualizar status');
      }
    },
  });

  const changePasswordMutation = useMutation({
    mutationFn: (data: { userId: string; password: string }) => api.changeUserPassword(data.userId, data.password),
    onSuccess: (res) => {
      if (res.success) {
        toast.success('Senha alterada com sucesso');
        setPasswordOpen(null);
        setChangePassword('');
        setChangePasswordConfirm('');
      } else {
        toast.error(res.error || 'Erro ao alterar senha');
      }
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (userId: string) => api.deleteUser(userId),
    onSuccess: async () => {
      toast.success('Usuário removido');
      await queryClient.invalidateQueries({ queryKey: ['users'] });
      await queryClient.refetchQueries({ queryKey: ['users'] });
      setDeleteTarget(null);
    },
  });

  const canCreate = newUsername.length >= 3 && newPassword.length >= 6 && newPassword === newPasswordConfirm;
  const canChangePass = changePassword.length >= 6 && changePassword === changePasswordConfirm;

  return (
    <div className="space-y-6 max-w-4xl">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Users size={20} className="text-primary" />
          <h2 className="text-lg font-semibold text-foreground">Gerenciamento de Usuários</h2>
        </div>
        <Button size="sm" onClick={() => setCreateOpen(true)}>
          <Plus size={14} className="mr-1" /> Novo Usuário
        </Button>
      </div>

      <div className="noc-panel p-0 overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Usuário</TableHead>
              <TableHead>Perfil</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Troca de senha</TableHead>
              <TableHead>Criado em</TableHead>
              <TableHead>Último login</TableHead>
              <TableHead className="text-right">Ações</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              <TableRow>
                 <TableCell colSpan={7} className="text-center py-8">
                  <Loader2 className="h-5 w-5 animate-spin mx-auto text-muted-foreground" />
                </TableCell>
              </TableRow>
            ) : users.length === 0 ? (
              <TableRow>
                <TableCell colSpan={7} className="text-center py-8 text-muted-foreground">
                  Nenhum usuário cadastrado
                </TableCell>
              </TableRow>
            ) : (
              users.map(u => {
                const active = isActive(u);
                const needsChange = mustChange(u);
                return (
                  <TableRow key={u.id}>
                    <TableCell className="font-mono text-sm">{u.username}</TableCell>
                    <TableCell>
                      <Badge variant="outline" className={u.role === 'viewer' ? 'text-accent border-accent/30' : 'text-primary border-primary/30'}>
                        {u.role === 'viewer' ? 'Viewer' : 'Admin'}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <Badge variant={active ? 'default' : 'secondary'} className={active ? 'bg-success/20 text-success border-success/30' : ''}>
                        {active ? 'Ativo' : 'Inativo'}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      {needsChange && (
                        <Badge variant="outline" className="text-warning border-warning/30">
                          Pendente
                        </Badge>
                      )}
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground font-mono">
                      {safeDate(createdAt(u))}
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground font-mono">
                      {safeDate(lastLogin(u))}
                    </TableCell>
                    <TableCell className="text-right space-x-1">
                      <Button variant="ghost" size="icon" title="Alterar senha" onClick={() => setPasswordOpen(u.id)}>
                        <KeyRound size={14} />
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        title={active ? 'Desativar' : 'Ativar'}
                        onClick={() => toggleMutation.mutate({ userId: u.id, active: !active })}
                        disabled={u.id === currentUser?.id}
                        className="px-2"
                      >
                        {active ? 'Desativar' : 'Ativar'}
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        title="Excluir"
                        className="text-destructive hover:text-destructive"
                        onClick={() => setDeleteTarget(u.id)}
                        disabled={u.id === currentUser?.id}
                      >
                        <Trash2 size={14} />
                      </Button>
                    </TableCell>
                  </TableRow>
                );
              })
            )}
          </TableBody>
        </Table>
      </div>

      {/* Create user dialog */}
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Novo Usuário</DialogTitle>
            <DialogDescription>Crie uma nova conta de acesso ao DNS Control.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <Label>Usuário</Label>
              <Input value={newUsername} onChange={e => setNewUsername(e.target.value)} placeholder="username" autoFocus />
              {newUsername.length > 0 && newUsername.length < 3 && (
                <p className="text-xs text-destructive">Mínimo 3 caracteres</p>
              )}
            </div>
            <div className="space-y-2">
              <Label>Senha</Label>
              <Input type="password" value={newPassword} onChange={e => setNewPassword(e.target.value)} placeholder="••••••••" />
              {newPassword.length > 0 && newPassword.length < 6 && (
                <p className="text-xs text-destructive">Mínimo 6 caracteres</p>
              )}
            </div>
            <div className="space-y-2">
              <Label>Confirmar senha</Label>
              <Input type="password" value={newPasswordConfirm} onChange={e => setNewPasswordConfirm(e.target.value)} placeholder="••••••••" />
              {newPasswordConfirm.length > 0 && newPassword !== newPasswordConfirm && (
                <p className="text-xs text-destructive">Senhas não conferem</p>
              )}
            </div>
            <div className="flex items-center gap-3">
              <Switch checked={mustChangePassword} onCheckedChange={setMustChangePassword} />
              <Label>Forçar troca de senha no primeiro login</Label>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateOpen(false)}>Cancelar</Button>
            <Button onClick={() => createMutation.mutate({ username: newUsername, password: newPassword })} disabled={!canCreate || createMutation.isPending}>
              {createMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : null}
              Criar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Change password dialog */}
      <Dialog open={!!passwordOpen} onOpenChange={() => setPasswordOpen(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Alterar Senha</DialogTitle>
            <DialogDescription>Defina uma nova senha para este usuário.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <Label>Nova senha</Label>
              <Input type="password" value={changePassword} onChange={e => setChangePassword(e.target.value)} placeholder="••••••••" autoFocus />
            </div>
            <div className="space-y-2">
              <Label>Confirmar nova senha</Label>
              <Input type="password" value={changePasswordConfirm} onChange={e => setChangePasswordConfirm(e.target.value)} placeholder="••••••••" />
              {changePasswordConfirm.length > 0 && changePassword !== changePasswordConfirm && (
                <p className="text-xs text-destructive">Senhas não conferem</p>
              )}
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPasswordOpen(null)}>Cancelar</Button>
            <Button
              onClick={() => passwordOpen && changePasswordMutation.mutate({ userId: passwordOpen, password: changePassword })}
              disabled={!canChangePass || changePasswordMutation.isPending}
            >
              Alterar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete confirmation */}
      <AlertDialog open={!!deleteTarget} onOpenChange={() => setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Excluir usuário</AlertDialogTitle>
            <AlertDialogDescription>
              Esta ação não pode ser desfeita. O usuário será removido permanentemente.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => deleteTarget && deleteMutation.mutate(deleteTarget)}
            >
              Excluir
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
