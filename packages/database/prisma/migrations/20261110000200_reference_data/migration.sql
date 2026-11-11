-- Datos de referencia: catalogo de permisos y los cuatro planes.
-- Los precios quedan en 0: se definen desde el panel de superadministrador.

INSERT INTO permissions (code, description) VALUES
  ('tenant.manage',        'Editar datos de la empresa'),
  ('subscription.manage',  'Ver y cambiar la suscripcion'),
  ('branches.manage',      'Crear y editar sucursales'),
  ('members.manage',       'Invitar usuarios y asignar roles'),
  ('catalog.manage',       'Crear y editar servicios y categorias'),
  ('employees.manage',     'Crear y editar profesionales y horarios'),
  ('appointments.read',    'Ver la agenda de sus sucursales'),
  ('appointments.read.own','Ver solo su propia agenda'),
  ('appointments.manage',  'Crear, modificar y cancelar citas'),
  ('customers.read',       'Ver clientes'),
  ('customers.manage',     'Crear y editar clientes'),
  ('customers.export',     'Exportar y eliminar datos de clientes'),
  ('payments.manage',      'Registrar pagos'),
  ('payments.refund',      'Registrar reembolsos'),
  ('cash.manage',          'Abrir y cerrar caja'),
  ('commissions.read',     'Ver comisiones de todos'),
  ('commissions.read.own', 'Ver solo sus comisiones'),
  ('loyalty.manage',       'Configurar programas y campanas'),
  ('loyalty.adjust',       'Hacer ajustes manuales de puntos y sellos'),
  ('rewards.validate',     'Validar y marcar canjes de recompensas'),
  ('reports.read',         'Ver reportes y estadisticas'),
  ('audit.read',           'Ver el registro de auditoria');

INSERT INTO subscription_plans (code, name, price_monthly, price_yearly, max_employees, max_branches, features) VALUES
  ('inicial',     'Inicial',     0, 0, 1,    1,    '{"crm": false, "loyalty": false, "reports": false, "automations": false, "advanced_permissions": false}'),
  ('negocio',     'Negocio',     0, 0, 5,    1,    '{"crm": true,  "loyalty": true,  "reports": true,  "automations": false, "advanced_permissions": false}'),
  ('premium',     'Premium',     0, 0, 15,   1,    '{"crm": true,  "loyalty": true,  "reports": true,  "automations": true,  "advanced_permissions": false}'),
  ('empresarial', 'Empresarial', 0, 0, NULL, NULL, '{"crm": true,  "loyalty": true,  "reports": true,  "automations": true,  "advanced_permissions": true}');
