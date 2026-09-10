const fs = require('fs');
const path = require('path');

class REDCapClient {
  constructor(config = {}) {
    this.apiUrl = config.apiUrl || process.env.REDCAP_API_URL || null;
    this.apiToken = config.apiToken || process.env.REDCAP_API_TOKEN || null;
    this.isLive = Boolean(this.apiUrl && this.apiToken && !this.apiUrl.includes('example.com'));
    
    // In-memory / file-backed REDCap emulator store for audit & administrative inspection
    this.mockStorePath = path.join(__dirname, '../../data_redcap_mock.json');
    this.initMockStore();
  }

  initMockStore() {
    try {
      if (!fs.existsSync(this.mockStorePath)) {
        fs.writeFileSync(this.mockStorePath, JSON.stringify({ records: [], files: [], audit: [] }, null, 2));
      }
    } catch (e) {
      console.error('Failed to init mock REDCap store:', e);
    }
  }

  getMockData() {
    try {
      if (fs.existsSync(this.mockStorePath)) {
        return JSON.parse(fs.readFileSync(this.mockStorePath, 'utf8'));
      }
    } catch (e) {
      console.error('Error reading mock REDCap store:', e);
    }
    return { records: [], files: [], audit: [] };
  }

  saveMockData(data) {
    try {
      fs.writeFileSync(this.mockStorePath, JSON.stringify(data, null, 2));
    } catch (e) {
      console.error('Error saving mock REDCap store:', e);
    }
  }

  /**
   * Import or update record in REDCap
   */
  async importRecord(recordData) {
    const recordPayload = {
      ...recordData,
      redcap_event_name: 'attendance_arm_1'
    };

    if (this.isLive) {
      try {
        const formData = new URLSearchParams();
        formData.append('token', this.apiToken);
        formData.append('content', 'record');
        formData.append('format', 'json');
        formData.append('type', 'flat');
        formData.append('overwriteBehavior', 'overwrite');
        formData.append('data', JSON.stringify([recordPayload]));
        formData.append('returnContent', 'count');
        formData.append('returnFormat', 'json');

        const response = await fetch(this.apiUrl, {
          method: 'POST',
          body: formData
        });

        if (!response.ok) {
          const errText = await response.text();
          throw new Error(`REDCap API error (${response.status}): ${errText}`);
        }

        const result = await response.json();
        return { success: true, count: result.count || 1, mode: 'LIVE_REDCAP' };
      } catch (err) {
        console.error('Live REDCap sync failed, falling back to local audit buffer:', err.message);
        return this.saveToMockStore(recordPayload, 'SYNC_FAILED_FALLBACK_STORED', err.message);
      }
    } else {
      // Mock mode
      return this.saveToMockStore(recordPayload, 'STORED_IN_REDCAP_EMULATOR');
    }
  }

  saveToMockStore(recordPayload, statusMessage, errorDetail = null) {
    const store = this.getMockData();
    const existingIndex = store.records.findIndex(r => r.attendance_record_id === recordPayload.attendance_record_id);
    
    if (existingIndex >= 0) {
      store.records[existingIndex] = { ...store.records[existingIndex], ...recordPayload, updated_at: new Date().toISOString() };
    } else {
      store.records.push({ ...recordPayload, created_at: new Date().toISOString() });
    }

    store.audit.push({
      action: 'IMPORT_RECORD',
      record_id: recordPayload.attendance_record_id,
      timestamp: new Date().toISOString(),
      status: statusMessage,
      error: errorDetail
    });

    this.saveMockData(store);
    return {
      success: true,
      mode: this.isLive ? 'FALLBACK' : 'MOCK_EMULATOR',
      message: statusMessage,
      record_id: recordPayload.attendance_record_id
    };
  }

  /**
   * Import file (e.g. photo) to REDCap document repository
   */
  async importFile(recordId, fieldName, filePath, originalFilename) {
    if (!fs.existsSync(filePath)) {
      throw new Error(`File not found at ${filePath}`);
    }

    if (this.isLive) {
      try {
        const fileBuffer = fs.readFileSync(filePath);
        const blob = new Blob([fileBuffer]);
        const formData = new FormData();
        formData.append('token', this.apiToken);
        formData.append('content', 'file');
        formData.append('action', 'import');
        formData.append('record', recordId);
        formData.append('field', fieldName);
        formData.append('file', blob, originalFilename || path.basename(filePath));

        const response = await fetch(this.apiUrl, {
          method: 'POST',
          body: formData
        });

        if (!response.ok) {
          throw new Error(`REDCap File Upload failed (${response.status})`);
        }

        return { success: true, mode: 'LIVE_REDCAP', field: fieldName };
      } catch (err) {
        console.error(`Failed to upload ${fieldName} to live REDCap:`, err.message);
      }
    }

    // Mock storage
    const store = this.getMockData();
    store.files.push({
      record_id: recordId,
      field: fieldName,
      file_path: filePath,
      file_name: originalFilename || path.basename(filePath),
      file_size: fs.statSync(filePath).size,
      uploaded_at: new Date().toISOString()
    });
    this.saveMockData(store);

    return {
      success: true,
      mode: 'MOCK_EMULATOR',
      field: fieldName,
      message: 'Stored in REDCap file repository emulator'
    };
  }

  /**
   * Generate official REDCap Data Dictionary CSV
   */
  generateDataDictionaryCsv() {
    const schema = JSON.parse(fs.readFileSync(path.join(__dirname, 'schema.json'), 'utf8'));
    const headers = [
      'Variable / Field Name',
      'Form Name',
      'Section Header',
      'Field Type',
      'Field Label',
      'Choices, Calculations, OR Slider Labels',
      'Field Note',
      'Text Validation Type OR Show Slider Number',
      'Text Validation Min',
      'Text Validation Max',
      'Identifier?',
      'Branching Logic (Show field only if...)',
      'Required Field?',
      'Custom Alignment',
      'Question Number (surveys only)',
      'Matrix Group Name',
      'Matrix Ranking?',
      'Field Annotation'
    ];

    const rows = [headers.join(',')];
    for (const f of schema.fields) {
      const row = [
        f.field_name,
        f.form_name,
        '', // Section Header
        f.field_type,
        `"${(f.field_label || '').replace(/"/g, '""')}"`,
        `"${(f.select_choices_or_calculations || '').replace(/"/g, '""')}"`,
        '', // Field Note
        '', // Text Validation Type
        '', // Min
        '', // Max
        f.field_name.includes('photo') ? 'y' : 'n', // Identifier?
        '', // Branching Logic
        'y', // Required Field
        '',
        '',
        '',
        '',
        '@READONLY'
      ];
      rows.push(row.join(','));
    }

    return rows.join('\n');
  }
}

module.exports = new REDCapClient();
