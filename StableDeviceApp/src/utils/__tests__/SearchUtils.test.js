import { generateSearchSuggestions, filterDevices } from '../SearchUtils';

describe('SearchUtils', () => {
  const mockDevices = [
    { id: 1, name: '100Ω电阻', shelfId: '1' },
    { id: 2, name: '220Ω电阻', shelfId: '1' },
    { id: 3, name: '10μF电容', shelfId: '2' },
    { id: 4, name: '100μF电容', shelfId: '2' },
    { id: 5, name: 'LED灯', shelfId: '3' },
  ];

  const mockSearchHistory = ['电阻', '电容', 'LED'];

  describe('generateSearchSuggestions', () => {
    test('应该返回基于设备名称的建议', () => {
      const suggestions = generateSearchSuggestions('电阻', mockDevices, []);
      
      expect(suggestions.length).toBe(2);
      expect(suggestions).toContain('100Ω电阻');
      expect(suggestions).toContain('220Ω电阻');
    });

    test('应该返回基于搜索历史的建议', () => {
      const suggestions = generateSearchSuggestions('电', [], mockSearchHistory);
      
      expect(suggestions.length).toBe(2);
      expect(suggestions).toContain('电阻');
      expect(suggestions).toContain('电容');
    });

    test('空查询应该返回空数组', () => {
      const suggestions = generateSearchSuggestions('', mockDevices, mockSearchHistory);
      expect(suggestions).toEqual([]);
    });

    test('不匹配的查询应该返回空数组', () => {
      const suggestions = generateSearchSuggestions('不存在的器件', mockDevices, []);
      expect(suggestions).toEqual([]);
    });

    test('应该去重', () => {
      const devicesWithDuplicate = [
        ...mockDevices,
        { id: 6, name: '100Ω电阻', shelfId: '1' },
      ];
      
      const suggestions = generateSearchSuggestions('电阻', devicesWithDuplicate, []);
      
      expect(suggestions.length).toBe(2);
    });

    test('应该限制建议数量', () => {
      const suggestions = generateSearchSuggestions('电', mockDevices, mockSearchHistory, 2);
      
      expect(suggestions.length).toBe(2);
    });
  });

  describe('filterDevices', () => {
    test('应该根据器件架筛选', () => {
      const filtered = filterDevices(mockDevices, '', '1');
      
      expect(filtered.length).toBe(2);
      expect(filtered.every(d => d.shelfId === '1')).toBe(true);
    });

    test('应该根据搜索查询筛选', () => {
      const filtered = filterDevices(mockDevices, '电阻', '');
      
      expect(filtered.length).toBe(2);
      expect(filtered.every(d => d.name.includes('电阻'))).toBe(true);
    });

    test('应该同时根据器件架和搜索查询筛选', () => {
      const filtered = filterDevices(mockDevices, '电容', '2');
      
      expect(filtered.length).toBe(2);
      expect(filtered.every(d => d.shelfId === '2')).toBe(true);
      expect(filtered.every(d => d.name.includes('电容'))).toBe(true);
    });

    test('空筛选条件应该返回所有设备', () => {
      const filtered = filterDevices(mockDevices, '', '');
      
      expect(filtered.length).toBe(mockDevices.length);
    });

    test('应该支持按ID搜索', () => {
      const filtered = filterDevices(mockDevices, '2', '');
      
      expect(filtered.length).toBe(1);
      expect(filtered[0].id).toBe(2);
    });

    test('不匹配的筛选条件应该返回空数组', () => {
      const filtered = filterDevices(mockDevices, '不存在', '99');
      
      expect(filtered.length).toBe(0);
    });
  });
});