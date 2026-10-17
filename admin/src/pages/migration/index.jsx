import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import Layout from '../../components/Layout.jsx';
import Notice from '../../components/Notice.jsx';
import download from '../../utils/download.js';
import request from '../../utils/request.js';

export default function Migration() {
  const [exportLoading, setExportLoading] = useState(false);
  const [exportNotice, setExportNotice] = useState(null);

  const { t } = useTranslation();

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
      </div>
    </Layout>
  );
}
