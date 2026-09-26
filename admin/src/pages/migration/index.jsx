import React, { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import BottomSheet from '../../components/BottomSheet.jsx';
import Icon from '../../components/icon/ui.jsx';
import Layout from '../../components/Layout.jsx';
import Notice from '../../components/Notice.jsx';
import download from '../../utils/download.js';
import readFileAsync from '../../utils/readFileAsync.js';
import request from '../../utils/request.js';

export default function Migration() {
  const [importLoading, setImportLoading] = useState(false);
  const [exportLoading, setExportLoading] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [importNotice, setImportNotice] = useState(null);
  const [exportNotice, setExportNotice] = useState(null);

  const { t } = useTranslation();
  const uploadRef = useRef(null);

  const importDB = () => {
    setImportNotice(null);
    setConfirming(true);
  };

  const chooseFile = () => {
    setConfirming(false);
    uploadRef.current.click();
  };

  // oxlint-disable-next-line max-statements
  const importData = async (event) => {
    const file = event.target.files?.[0];

    if (!file) return;
    setImportNotice(null);

    try {
      const text = await readFileAsync(file);
      let data = null;

      try {
        data = JSON.parse(text);
      } catch {
        data = null;
      }

      if (!data || data.type !== 'waline' || !Array.isArray(data.tables) || !data.data) {
        setImportNotice({ tone: 'error', text: t('import format error') });

        return;
      }

      const maxLength = data.tables.reduce(
        (count, tableName) => count + (data.data[tableName]?.length ?? 0),
        0,
      );
      let importedLength = 0;

      setImportLoading([
        'importing {{importedLength}}/{{maxLength}}',
        { importedLength, maxLength },
      ]);

      const idMaps = {};

      for (const tableName of data.tables) {
        const tableData = data.data[tableName];

        // clean table data if not user table
        if (tableName !== 'Users') {
          // oxlint-disable-next-line no-await-in-loop
          await request({
            url: `db?table=${tableName}`,
            method: 'DELETE',
          });
        }

        idMaps[tableName] ??= {};
        if (!Array.isArray(tableData)) {
          continue;
        }

        for (const data of tableData) {
          let existUserObjectId = false;

          if (tableName === 'Users') {
            // oxlint-disable-next-line no-await-in-loop
            const user = await request(`user?email=${encodeURIComponent(data.email)}`);

            if (user.objectId) {
              existUserObjectId = user.objectId;
            }
          }

          const shouldEditorUser = tableName === 'Users' && existUserObjectId;
          const method = shouldEditorUser ? 'PUT' : 'POST';
          const body =
            tableName === 'Comment'
              ? {
                  ...data,
                  // add default approved status to avoid unsetted status comments import issue
                  status: data.status ?? 'approved',
                  // reset relationship fields
                  rid: undefined,
                  pid: undefined,
                  user_id: undefined,
                }
              : data;

          for (const key in body) {
            if (body[key] === null || body[key] === undefined) {
              // oxlint-disable-next-line typescript/no-dynamic-delete
              delete body[key];
            }
          }

          // oxlint-disable-next-line no-await-in-loop
          const resp = await request({
            url: `db?table=${tableName}${method === 'PUT' ? `&objectId=${existUserObjectId}` : ''}`,
            method,
            body,
          });

          idMaps[tableName][data.objectId] = resp.objectId ?? existUserObjectId;
          importedLength += 1;
          setImportLoading([
            'importing {{importedLength}}/{{maxLength}}',
            { importedLength, maxLength },
          ]);
        }
      }

      setImportLoading(['comment data index relationship reconstruction']);
      const commentData = data.data.Comment ?? [];
      const willUpdateData = [];

      for (const cmt of commentData) {
        const willUpdateItem = {};

        [
          { tableName: 'Comment', field: 'pid' },
          { tableName: 'Comment', field: 'rid' },
          { tableName: 'Users', field: 'user_id' },
        ].forEach(({ tableName, field }) => {
          if (!cmt[field]) {
            return;
          }

          const oldId = cmt[field];
          const newId = idMaps[tableName][cmt[field]];

          if (oldId && newId && oldId !== newId) {
            willUpdateItem[field] = newId;
          }
        });
        if (Object.keys(willUpdateItem).length === 0) {
          continue;
        }

        willUpdateData.push([willUpdateItem, { objectId: idMaps.Comment[cmt.objectId] }]);
      }

      importedLength = 0;
      for (const [willUpdateItem, where] of willUpdateData) {
        // oxlint-disable-next-line no-await-in-loop
        await request({
          url: `db?table=Comment&objectId=${where.objectId}`,
          method: 'PUT',
          body: willUpdateItem,
        });

        importedLength += 1;
        setImportLoading([
          'index updating {{importedLength}}/{{maxLength}}',
          { importedLength, maxLength: willUpdateData.length },
        ]);
      }

      setImportNotice({ tone: 'success', text: t('import success') });
    } catch (err) {
      setImportNotice({ tone: 'error', text: t('import failed', { message: err?.message || t('request failed') }) });
    } finally {
      setImportLoading(false);
      event.target.value = null;
    }
  };

  const exportDB = async () => {
    setExportLoading(true);
    setExportNotice(null);
    try {
      const data = await request('db');

      download(JSON.stringify(data, null, '\t'), 'waline.json', 'application/javascript');
    } catch (err) {
      setExportNotice({ tone: 'error', text: t('export failed', { message: err?.message || t('request failed') }) });
    } finally {
      setExportLoading(false);
    }
  };

  return (
    <Layout title={t('migration')}>
      <div className="migration">
        <section className="panel">
          <h2 className="panel-title">{t('export')}</h2>
          <Notice tone={exportNotice?.tone} onClose={() => setExportNotice(null)}>
            {exportNotice?.text}
          </Notice>
          <p className="muted">waline.json</p>
          <button className="btn btn-primary" type="button" onClick={exportDB} disabled={exportLoading}>
            {exportLoading ? t('exporting') : t('export')}
          </button>
        </section>
        <section className="panel">
          <h2 className="panel-title">{t('import')}</h2>
          <Notice tone={importNotice?.tone} onClose={() => setImportNotice(null)} className="import-notice">
            {importNotice?.text}
          </Notice>
          <p className="muted">{t('import clear data confirm')}</p>
          <button className="btn btn-danger" type="button" onClick={importDB} disabled={Boolean(importLoading)}>
            {Array.isArray(importLoading) ? t(...importLoading) : t('import')}
          </button>
          <input
            ref={uploadRef}
            onChange={importData}
            type="file"
            accept=".json,application/json"
            hidden
          />
        </section>
      </div>
      <BottomSheet open={confirming} onClose={() => setConfirming(false)} title={t('import confirm title')}>
        <div className="confirm-box" role="alertdialog" aria-labelledby="confirm-import-text">
          <p id="confirm-import-text">{t('import clear data confirm')}</p>
          <div className="confirm-actions">
            <button type="button" className="btn" data-autofocus onClick={() => setConfirming(false)}>
              {t('cancel')}
            </button>
            <button type="button" className="btn btn-danger btn-solid act-import-confirm" onClick={chooseFile}>
              <Icon name="transfer" size={18} />
              {t('choose file')}
            </button>
          </div>
        </div>
      </BottomSheet>
    </Layout>
  );
}
