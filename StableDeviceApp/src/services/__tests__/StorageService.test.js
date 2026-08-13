import StorageService from '../StorageService';

describe('StorageService', () => {
  beforeEach(async () => {
    await StorageService.clearAll();
  });

  describe('器件管理', () => {
    test('应该能够添加器件', async () => {
      const device = { name: '测试电阻', resistance: '100Ω' };
      const result = await StorageService.addDevice(device);
      
      expect(result).toHaveProperty('id');
      expect(result.name).toBe('测试电阻');
      expect(result.resistance).toBe('100Ω');
      expect(result).toHaveProperty('createdAt');
      expect(result).toHaveProperty('updatedAt');
    });

    test('应该能够获取所有器件', async () => {
      await StorageService.addDevice({ name: '电阻1' });
      await StorageService.addDevice({ name: '电阻2' });
      
      const devices = await StorageService.getDevices();
      
      expect(Array.isArray(devices)).toBe(true);
      expect(devices.length).toBe(2);
    });

    test('应该能够根据ID获取器件', async () => {
      const device = await StorageService.addDevice({ name: '电容' });
      
      const found = await StorageService.getDeviceById(device.id);
      
      expect(found).not.toBeNull();
      expect(found.name).toBe('电容');
    });

    test('应该能够更新器件', async () => {
      const device = await StorageService.addDevice({ name: '旧名称' });
      await new Promise(resolve => setTimeout(resolve, 10));
      const updated = await StorageService.updateDevice({ ...device, name: '新名称' });
      
      expect(updated).not.toBeNull();
      expect(updated.name).toBe('新名称');
    });

    test('应该能够删除器件', async () => {
      const device = await StorageService.addDevice({ name: '要删除的器件' });
      const result = await StorageService.deleteDevice(device.id);
      
      expect(result).toBe(true);
      
      const found = await StorageService.getDeviceById(device.id);
      expect(found).toBeNull();
    });

    test('应该能够搜索器件', async () => {
      await StorageService.addDevice({ name: '100Ω电阻', resistance: '100Ω' });
      await StorageService.addDevice({ name: '220Ω电阻', resistance: '220Ω' });
      await StorageService.addDevice({ name: '10μF电容', capacitance: '10μF' });
      
      const results = await StorageService.searchDevices('电阻');
      
      expect(results.length).toBe(2);
      expect(results.every(d => d.name.includes('电阻'))).toBe(true);
    });

    test('应该能够过滤器件', async () => {
      await StorageService.addDevice({ name: '器件A', shelfId: '1' });
      await StorageService.addDevice({ name: '器件B', shelfId: '2' });

      const results = await StorageService.filterDevices({ shelfId: '1' });

      expect(results.length).toBe(1);
      expect(results[0].name).toBe('器件A');
    });
  });

  describe('按数量存取 (adjustStock)', () => {
    test('存入应该增加数量', async () => {
      const device = await StorageService.addDevice({ name: '电阻', quantity: 5 });

      const updated = await StorageService.adjustStock(device.id, 3);

      expect(updated.quantity).toBe(8);
      // 持久化生效
      const reloaded = await StorageService.getDeviceById(device.id);
      expect(reloaded.quantity).toBe(8);
    });

    test('取用应该减少数量', async () => {
      const device = await StorageService.addDevice({ name: '电阻', quantity: 10 });

      const updated = await StorageService.adjustStock(device.id, -4);

      expect(updated.quantity).toBe(6);
      const reloaded = await StorageService.getDeviceById(device.id);
      expect(reloaded.quantity).toBe(6);
    });

    test('取用到 0 应该成功', async () => {
      const device = await StorageService.addDevice({ name: '电阻', quantity: 3 });

      const updated = await StorageService.adjustStock(device.id, -3);

      expect(updated.quantity).toBe(0);
    });

    test('取用超过库存应该抛出"库存不足"', async () => {
      const device = await StorageService.addDevice({ name: '电阻', quantity: 2 });

      await expect(StorageService.adjustStock(device.id, -5)).rejects.toThrow(
        /库存不足/
      );
      // 数量不应改变
      const reloaded = await StorageService.getDeviceById(device.id);
      expect(reloaded.quantity).toBe(2);
    });

    test('delta 为 0 应该抛出错误', async () => {
      const device = await StorageService.addDevice({ name: '电阻', quantity: 5 });

      await expect(StorageService.adjustStock(device.id, 0)).rejects.toThrow(
        /非零/
      );
    });

    test('缺少 deviceId 应该抛出错误', async () => {
      await expect(StorageService.adjustStock(null, 1)).rejects.toThrow(
        /缺少器件ID/
      );
    });

    test('器件不存在应该抛出错误', async () => {
      await expect(StorageService.adjustStock(99999, 1)).rejects.toThrow(
        /器件不存在/
      );
    });

    test('连续存取应该正确累计', async () => {
      const device = await StorageService.addDevice({ name: '电阻', quantity: 5 });

      await StorageService.adjustStock(device.id, 3);   // 8
      await StorageService.adjustStock(device.id, -2);  // 6
      const final = await StorageService.adjustStock(device.id, 4); // 10

      expect(final.quantity).toBe(10);
    });
  });

  describe('搜索历史', () => {
    test('应该能够添加搜索历史', async () => {
      await StorageService.addSearchHistory('电阻');
      await StorageService.addSearchHistory('电容');
      
      const history = await StorageService.getSearchHistory();
      
      expect(Array.isArray(history)).toBe(true);
      expect(history.length).toBe(2);
      expect(history[0]).toBe('电容');
      expect(history[1]).toBe('电阻');
    });

    test('搜索历史应该去重', async () => {
      await StorageService.addSearchHistory('电阻');
      await StorageService.addSearchHistory('电阻');
      await StorageService.addSearchHistory('电阻');
      
      const history = await StorageService.getSearchHistory();
      
      expect(history.length).toBe(1);
    });

    test('应该能够清除搜索历史', async () => {
      await StorageService.addSearchHistory('电阻');
      await StorageService.clearSearchHistory();
      
      const history = await StorageService.getSearchHistory();
      
      expect(history.length).toBe(0);
    });
  });

  describe('BOM管理', () => {
    test('应该能够添加BOM', async () => {
      const bom = { name: '测试BOM', components: [] };
      const result = await StorageService.addBOM(bom);
      
      expect(result).toHaveProperty('id');
      expect(result.name).toBe('测试BOM');
      expect(result).toHaveProperty('createdAt');
    });

    test('应该能够获取所有BOM', async () => {
      await StorageService.addBOM({ name: 'BOM1' });
      await StorageService.addBOM({ name: 'BOM2' });
      
      const boms = await StorageService.getBOMs();
      
      expect(boms.length).toBe(2);
    });

    test('应该能够根据ID获取BOM', async () => {
      const bom = await StorageService.addBOM({ name: '查找BOM' });
      const found = await StorageService.getBOMById(bom.id);
      
      expect(found).not.toBeNull();
      expect(found.name).toBe('查找BOM');
    });

    test('应该能够更新BOM', async () => {
      const bom = await StorageService.addBOM({ name: '旧名称' });
      const result = await StorageService.updateBOM({ ...bom, name: '新名称' });
      
      expect(result).toBe(true);
      
      const updated = await StorageService.getBOMById(bom.id);
      expect(updated.name).toBe('新名称');
    });

    test('应该能够删除BOM', async () => {
      const bom = await StorageService.addBOM({ name: '要删除的BOM' });
      const result = await StorageService.deleteBOM(bom.id);
      
      expect(result).toBe(true);
      
      const found = await StorageService.getBOMById(bom.id);
      expect(found).toBeNull();
    });
  });

  describe('CSV导入', () => {
    test('应该能够从CSV导入器件', async () => {
      const csvContent = `器件名称,器件架,位号
100Ω电阻,A,C1
220Ω电阻,B,C2
10μF电容,A,C3`;
      
      const result = await StorageService.importDevicesFromCSV(csvContent);
      
      expect(result.success).toBe(true);
      expect(result.imported).toBe(3);
      
      const devices = await StorageService.getDevices();
      expect(devices.length).toBe(3);
    });

    test('缺少器件架列应该返回错误', async () => {
      const csvContent = `器件名称,位号
100Ω电阻,C1`;
      
      const result = await StorageService.importDevicesFromCSV(csvContent);
      
      expect(result.success).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
    });

    test('器件架值应该正确转换', async () => {
      const csvContent = `器件名称,器件架
电阻1,A
电阻2,B
电阻3,1
电阻4,2`;
      
      const result = await StorageService.importDevicesFromCSV(csvContent);
      
      expect(result.success).toBe(true);
      
      const devices = await StorageService.getDevices();
      const shelfIds = devices.map(d => d.shelfId);
      
      expect(shelfIds).toContain('1');
      expect(shelfIds).toContain('2');
    });
  });

  describe('数据导入导出', () => {
    test('应该能够导出所有数据', async () => {
      await StorageService.addDevice({ name: '测试器件' });
      await StorageService.addBOM({ name: '测试BOM' });

      const exportData = await StorageService.exportAllData();

      expect(exportData).toHaveProperty('data');
      expect(exportData).toHaveProperty('exportDate');
      expect(exportData).toHaveProperty('version');
      // 1.1.0 起，导出始终包含 categories 字段
      expect(exportData.version).toBe('1.1.0');
      expect(exportData.data).toHaveProperty('categories');
      expect(Array.isArray(exportData.data.categories)).toBe(true);
      expect(exportData.data.categories.length).toBeGreaterThan(0);
      // 摘要字段
      expect(exportData).toHaveProperty('summary');
      expect(exportData.summary.deviceCount).toBe(1);
      expect(exportData.summary.bomCount).toBe(1);
      expect(exportData.summary.categoryCount).toBeGreaterThan(0);
    });

    test('应该能够导入备份数据', async () => {
      await StorageService.addDevice({ name: '原始器件' });

      const backup = await StorageService.exportAllData();

      await StorageService.clearAll();

      const result = await StorageService.importAllData(backup);

      expect(result).toBe(true);

      const devices = await StorageService.getDevices();
      expect(devices.length).toBe(1);
    });

    test('1.0.0 旧版本备份应该能兼容导入（不覆盖 categories）', async () => {
      // 模拟 1.0.0 旧版本备份：没有 categories 字段
      const legacyBackup = {
        data: {
          devices: [{ id: 1, name: '旧版本器件' }],
        },
        version: '1.0.0',
      };
      const result = await StorageService.importAllData(legacyBackup);
      expect(result).toBe(true);
      const devices = await StorageService.getDevices();
      expect(devices.length).toBe(1);
      expect(devices[0].name).toBe('旧版本器件');
    });

    test('1.1.0 备份应能完整覆盖 categories', async () => {
      const customCats = [
        { name: '自定义大分类A', subCategories: ['子1', '子2'] },
        { name: '自定义大分类B', subCategories: [] },
      ];
      const backup = {
        data: {
          devices: [],
          categories: customCats,
        },
        version: '1.1.0',
      };
      const result = await StorageService.importAllData(backup);
      expect(result).toBe(true);
      const cats = await StorageService.getCategories();
      expect(cats).toEqual(customCats);
    });

    test('无效的备份数据应该抛出错误', async () => {
      await expect(StorageService.importAllData(null)).rejects.toThrow('无效的备份数据');
      await expect(StorageService.importAllData({})).rejects.toThrow('无效的备份数据');
    });

    test('不支持的版本应该抛出错误', async () => {
      await expect(
        StorageService.importAllData({ data: {}, version: '0.9.0' })
      ).rejects.toThrow('备份数据版本不兼容');
    });
  });
});